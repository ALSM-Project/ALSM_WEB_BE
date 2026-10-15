import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import {
  MEETING_REPOSITORY,
  MeetingRecord,
  MeetingRepository,
} from '../domain/meeting.types';
import { PROJECT_REPOSITORY, ProjectRepository } from '../../projects/domain/project.types';
import { MailService } from '../../../shared/mail/mail.service';
import { GoogleCalendarService } from '../../../shared/google/google-calendar.service';

// Google Meet code format: 3-4-3 lowercase letters (e.g. abc-defg-hij)
const MEET_CODE_PART_CHARS = 'abcdefghijklmnopqrstuvwxyz';

function generateMeetCode(): string {
  const rand = (len: number): string =>
    Array.from({ length: len }, () =>
      MEET_CODE_PART_CHARS[Math.floor(Math.random() * MEET_CODE_PART_CHARS.length)],
    ).join('');
  return `${rand(3)}-${rand(4)}-${rand(3)}`;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class CreateMeetingService {
  private readonly logger = new Logger(CreateMeetingService.name);

  constructor(
    @Inject(MEETING_REPOSITORY) private readonly meetings: MeetingRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    private readonly mail: MailService,
    private readonly googleCalendar: GoogleCalendarService,
  ) {}

  async execute(
    userId: string,
    userEmail: string,
    input: {
      title: string;
      description?: string;
      customMeetingUrl?: string;
      projectId?: string;
      attendeeEmails: string[];
      scheduledStartTime: Date;
      scheduledEndTime: Date;
    },
  ): Promise<MeetingRecord> {
    const title = input.title?.trim();
    if (!title || title.length < 3) {
      throw new BadRequestException({ code: 'MEETING_TITLE_REQUIRED', message: 'Meeting title is required and must be at least 3 characters' });
    }

    const description = input.description?.trim();
    if (!description || description.length < 5) {
      throw new BadRequestException({ code: 'MEETING_DESCRIPTION_REQUIRED', message: 'Meeting description/agenda is required (at least 5 characters)' });
    }

    const projectId = input.projectId?.trim();
    if (!projectId) {
      throw new BadRequestException({ code: 'PROJECT_ID_REQUIRED', message: 'Related project ID is required' });
    }

    const project = await this.projects.findById(projectId, '');
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: `Project with ID '${projectId}' does not exist`,
      });
    }

    const start = new Date(input.scheduledStartTime);
    const end = new Date(input.scheduledEndTime);

    if (isNaN(start.getTime())) {
      throw new BadRequestException({ code: 'INVALID_START_TIME', message: 'scheduledStartTime is not a valid date' });
    }
    if (isNaN(end.getTime())) {
      throw new BadRequestException({ code: 'INVALID_END_TIME', message: 'scheduledEndTime is not a valid date' });
    }

    // scheduledStartTime must be now or in the future (allow 1-minute tolerance)
    const now = new Date();
    if (start.getTime() < now.getTime() - 60_000) {
      throw new BadRequestException({
        code: 'START_TIME_IN_PAST',
        message: 'scheduledStartTime must be now or in the future',
      });
    }

    if (end <= start) {
      throw new BadRequestException({
        code: 'INVALID_TIME_RANGE',
        message: 'scheduledEndTime must be after scheduledStartTime',
      });
    }

    const attendeeEmails = (input.attendeeEmails ?? []).map((e) => e.trim().toLowerCase());
    if (attendeeEmails.length === 0) {
      throw new BadRequestException({ code: 'ATTENDEES_REQUIRED', message: 'At least one attendee email is required' });
    }
    const invalidEmail = attendeeEmails.find((e) => !EMAIL_PATTERN.test(e));
    if (invalidEmail) {
      throw new BadRequestException({
        code: 'INVALID_ATTENDEE_EMAIL',
        message: `Invalid attendee email address: ${invalidEmail}`,
      });
    }

    // Prevent duplicate meetings (same host + title + start time)
    const duplicate = await this.meetings.findDuplicate(userId, title, start);
    if (duplicate) {
      throw new ConflictException({
        code: 'DUPLICATE_MEETING',
        message: 'A meeting with the same title and start time already exists',
      });
    }

    // Resolve Google Meet URL & code
    let meetingUrl: string;
    let meetingCode: string;
    let calendarEventId: string | undefined;

    if (input.customMeetingUrl) {
      // User provided a custom link — validate and use it
      const urlMatch = input.customMeetingUrl.match(/https:\/\/meet\.google\.com\/([a-z0-9][a-z0-9-]*)/);
      if (!urlMatch) {
        throw new BadRequestException({
          code: 'INVALID_MEET_URL',
          message: 'customMeetingUrl must be a valid Google Meet link (https://meet.google.com/xxx-yyyy-zzz)',
        });
      }
      meetingUrl = input.customMeetingUrl;
      meetingCode = urlMatch[1];
    } else if (this.googleCalendar.isEnabled) {
      // Create a REAL Google Calendar event with conferencing → real Meet link
      const projectName = (project as { name?: string }).name ?? projectId;
      const gcalResult = await this.googleCalendar.createMeetingEvent({
        title,
        description: description ?? '',
        attendeeEmails,
        hostEmail: userEmail,
        scheduledStartTime: start,
        scheduledEndTime: end,
      });
      meetingUrl = gcalResult.meetingUrl;
      meetingCode = gcalResult.meetingCode;
      calendarEventId = gcalResult.calendarEventId;
      this.logger.log(`Real Google Meet created via Calendar API: ${meetingUrl} | Project: ${projectName}`);
    } else {
      // Fallback: random code (for dev/demo only — links won't be joinable)
      this.logger.warn(
        'GOOGLE_SERVICE_ACCOUNT_JSON not configured — generating a placeholder Meet URL. ' +
          'Set up Google Calendar integration for real Meet links.',
      );
      meetingCode = generateMeetCode();
      meetingUrl = `https://meet.google.com/${meetingCode}`;
    }

    const meeting = await this.meetings.create({
      title,
      description,
      meetingUrl,
      meetingCode,
      calendarEventId,
      hostUserId: userId,
      hostEmail: userEmail,
      projectId,
      attendeeEmails,
      scheduledStartTime: start,
      scheduledEndTime: end,
    });

    await this.audit.append({
      actorUserId: userId,
      action: 'MEETING_ROOM_CREATED',
      resourceType: 'MEETING',
      resourceId: meeting.id,
      metadata: {
        title: meeting.title,
        meetingCode: meeting.meetingCode,
        scheduledStartTime: meeting.scheduledStartTime.toISOString(),
      },
    });

    // Send invitation emails to all attendees (fire-and-forget, non-blocking)
    const projectName = (project as { name?: string }).name ?? projectId;
    void Promise.allSettled(
      attendeeEmails.map((to) =>
        this.mail.sendMeetingInvite({
          to,
          hostName: userEmail,
          hostEmail: userEmail,
          meetingTitle: meeting.title,
          meetingUrl: meeting.meetingUrl,
          scheduledStartTime: meeting.scheduledStartTime,
          scheduledEndTime: meeting.scheduledEndTime,
          description: meeting.description ?? '',
          projectName,
        }).catch((err: unknown) =>
          this.logger.error(`Failed to send invite to ${to}: ${(err as Error).message}`),
        ),
      ),
    );

    return meeting;
  }
}
