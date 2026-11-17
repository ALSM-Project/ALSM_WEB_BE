import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  MEETING_REPOSITORY,
  MeetingRecord,
  MeetingRepository,
  MeetingStatus,
  UpdateMeetingInput,
} from '../domain/meeting.types';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import { UpdateMeetingDto } from '../presentation/meeting.dto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class ManageMeetingService {
  private readonly logger = new Logger(ManageMeetingService.name);

  constructor(
    @Inject(MEETING_REPOSITORY) private readonly meetings: MeetingRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  async getById(id: string): Promise<MeetingRecord & { projectName?: string }> {
    const meeting = await this.meetings.findById(id);
    if (!meeting) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' was not found`,
      });
    }

    let projectName: string | undefined;
    if (meeting.projectId) {
      try {
        const proj = await this.projects.findById(meeting.projectId, '');
        if (proj) projectName = (proj as { name?: string }).name;
      } catch {
        // ignore project lookup failure
      }
    }

    return {
      ...meeting,
      projectName,
    };
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateMeetingDto,
  ): Promise<MeetingRecord> {
    const existing = await this.meetings.findById(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' was not found`,
      });
    }

    const input: UpdateMeetingInput = {};

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (title.length < 3) {
        throw new BadRequestException({
          code: 'MEETING_TITLE_REQUIRED',
          message: 'Meeting title must be at least 3 characters',
        });
      }
      input.title = title;
    }

    if (dto.description !== undefined) {
      const desc = dto.description.trim();
      if (desc.length < 5) {
        throw new BadRequestException({
          code: 'MEETING_DESCRIPTION_REQUIRED',
          message: 'Meeting description/agenda must be at least 5 characters',
        });
      }
      input.description = desc;
    }

    if (dto.customMeetingUrl !== undefined) {
      const url = dto.customMeetingUrl.trim();
      const match = url.match(/https:\/\/meet\.google\.com\/([a-z0-9][a-z0-9-]*)/);
      if (!match) {
        throw new BadRequestException({
          code: 'INVALID_MEET_URL',
          message: 'customMeetingUrl must be a valid Google Meet link (https://meet.google.com/xxx-yyyy-zzz)',
        });
      }
      input.meetingUrl = url;
      input.meetingCode = match[1];
    }

    if (dto.projectId !== undefined) {
      input.projectId = dto.projectId.trim();
    }

    if (dto.attendeeEmails !== undefined) {
      const emails = dto.attendeeEmails.map((e) => e.trim().toLowerCase());
      const invalid = emails.find((e) => !EMAIL_PATTERN.test(e));
      if (invalid) {
        throw new BadRequestException({
          code: 'INVALID_ATTENDEE_EMAIL',
          message: `Invalid attendee email: ${invalid}`,
        });
      }
      input.attendeeEmails = emails;
    }

    // Time range validation
    const start = dto.scheduledStartTime ? new Date(dto.scheduledStartTime) : existing.scheduledStartTime;
    const end = dto.scheduledEndTime ? new Date(dto.scheduledEndTime) : existing.scheduledEndTime;

    if (isNaN(start.getTime())) {
      throw new BadRequestException({ code: 'INVALID_START_TIME', message: 'Invalid start time' });
    }
    if (isNaN(end.getTime())) {
      throw new BadRequestException({ code: 'INVALID_END_TIME', message: 'Invalid end time' });
    }
    if (end <= start) {
      throw new BadRequestException({
        code: 'INVALID_TIME_RANGE',
        message: 'scheduledEndTime must be after scheduledStartTime',
      });
    }

    if (dto.scheduledStartTime !== undefined) input.scheduledStartTime = start;
    if (dto.scheduledEndTime !== undefined) input.scheduledEndTime = end;

    if (dto.status !== undefined) {
      if (!Object.values(MeetingStatus).includes(dto.status as MeetingStatus)) {
        throw new BadRequestException({
          code: 'INVALID_STATUS',
          message: `Status must be one of: ${Object.values(MeetingStatus).join(', ')}`,
        });
      }
      input.status = dto.status as MeetingStatus;
    }

    const updated = await this.meetings.update(id, input);
    if (!updated) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' could not be updated`,
      });
    }

    await this.audit.append({
      actorUserId: userId,
      action: 'MEETING_ROOM_UPDATED',
      resourceType: 'MEETING',
      resourceId: updated.id,
      metadata: {
        title: updated.title,
        status: updated.status,
        scheduledStartTime: updated.scheduledStartTime.toISOString(),
      },
    });

    return updated;
  }

  async updateStatus(
    id: string,
    userId: string,
    statusStr: string,
  ): Promise<MeetingRecord> {
    const existing = await this.meetings.findById(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' was not found`,
      });
    }

    if (!Object.values(MeetingStatus).includes(statusStr as MeetingStatus)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `Status must be one of: ${Object.values(MeetingStatus).join(', ')}`,
      });
    }

    const newStatus = statusStr as MeetingStatus;
    const updated = await this.meetings.update(id, { status: newStatus });
    if (!updated) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' could not be updated`,
      });
    }

    await this.audit.append({
      actorUserId: userId,
      action: 'MEETING_STATUS_CHANGED',
      resourceType: 'MEETING',
      resourceId: updated.id,
      metadata: {
        previousStatus: existing.status,
        newStatus: updated.status,
      },
    });

    return updated;
  }

  async delete(id: string, userId: string): Promise<{ success: boolean; message: string }> {
    const existing = await this.meetings.findById(id);
    if (!existing) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' was not found`,
      });
    }

    const deleted = await this.meetings.delete(id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'MEETING_NOT_FOUND',
        message: `Meeting with ID '${id}' could not be deleted`,
      });
    }

    await this.audit.append({
      actorUserId: userId,
      action: 'MEETING_ROOM_DELETED',
      resourceType: 'MEETING',
      resourceId: id,
      metadata: {
        title: existing.title,
        meetingCode: existing.meetingCode,
      },
    });

    return { success: true, message: 'Meeting room deleted successfully' };
  }
}
