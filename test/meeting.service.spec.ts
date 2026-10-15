import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CreateMeetingService } from '../src/modules/meetings/application/create-meeting.service';
import { ListMeetingsService } from '../src/modules/meetings/application/list-meetings.service';
import { MeetingRepository, MeetingStatus } from '../src/modules/meetings/domain/meeting.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ProjectRepository, ProjectRecord } from '../src/modules/projects/domain/project.types';
import { MailService } from '../src/shared/mail/mail.service';
import { GoogleCalendarService } from '../src/shared/google/google-calendar.service';

function getFutureDates() {
  const now = Date.now();
  const start = new Date(now + 24 * 60 * 60 * 1000); // +24 hours
  const end = new Date(now + 25 * 60 * 60 * 1000);   // +25 hours
  return { start, end };
}

function baseMeeting(start?: Date, end?: Date) {
  const dates = getFutureDates();
  return {
    id: 'meeting-1',
    title: 'Sprint Review — Project Phoenix',
    description: 'Review of sprint goals and backlog items',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    meetingCode: 'abc-defg-hij',
    hostUserId: 'user-1',
    hostEmail: 'host@enterprise.com',
    attendeeEmails: ['alice@corp.com', 'bob@corp.com'],
    projectId: 'proj-1',
    scheduledStartTime: start || dates.start,
    scheduledEndTime: end || dates.end,
    status: MeetingStatus.SCHEDULED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeMeeting(overrides: Partial<ReturnType<typeof baseMeeting>> = {}) {
  return { ...baseMeeting(), ...overrides };
}

function validMeetingInput(overrides: Record<string, unknown> = {}) {
  const { start, end } = getFutureDates();
  return {
    title: 'Sprint Review — Project Phoenix',
    description: 'Sprint 14 review and roadmap discussion',
    projectId: 'proj-1',
    attendeeEmails: ['alice@corp.com'],
    scheduledStartTime: start,
    scheduledEndTime: end,
    ...overrides,
  };
}

describe('CreateMeetingService (UC-43 Strict Validations)', () => {
  let meetings: jest.Mocked<MeetingRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let projects: jest.Mocked<ProjectRepository>;
  let service: CreateMeetingService;

  beforeEach(() => {
    meetings = {
      create: jest.fn(),
      findById: jest.fn(),
      listByHost: jest.fn(),
      list: jest.fn(),
      findDuplicate: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<MeetingRepository>;

    audit = { append: jest.fn() } as unknown as jest.Mocked<AuditRepository>;

    projects = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Project 1' } as unknown as ProjectRecord),
      findAll: jest.fn(),
      findByName: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findAssignedToUser: jest.fn(),
      countByOrganization: jest.fn(),
      assignUser: jest.fn(),
      unassignUser: jest.fn(),
    } as unknown as jest.Mocked<ProjectRepository>;

    const mailService = {
      sendMeetingInvite: jest.fn().mockResolvedValue(undefined),
    } as unknown as MailService;

    const googleCalendarService = {
      isEnabled: false,
      createMeetingEvent: jest.fn(),
    } as unknown as GoogleCalendarService;

    service = new CreateMeetingService(meetings, audit, projects, mailService, googleCalendarService);
  });

  // ─── 1. Title Validation ───
  it('rejects a blank title', async () => {
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ title: '   ' })),
    ).rejects.toThrow(BadRequestException);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  it('rejects a title shorter than 3 characters', async () => {
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ title: 'AB' })),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── 2. Description / Agenda Validation ───
  it('rejects when description is missing or blank', async () => {
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ description: '   ' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a description shorter than 5 characters', async () => {
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ description: 'Todo' })),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── 3. Project ID Validation ───
  it('rejects when projectId is missing or blank', async () => {
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ projectId: '   ' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-existent projectId', async () => {
    projects.findById.mockResolvedValue(null);
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ projectId: 'invalid-id' })),
    ).rejects.toThrow(NotFoundException);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  // ─── 4. Attendees Validation ───
  it('rejects when attendeeEmails list is empty', async () => {
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput({ attendeeEmails: [] })),
    ).rejects.toThrow(BadRequestException);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid attendee email format', async () => {
    await expect(
      service.execute(
        'user-1',
        'host@enterprise.com',
        validMeetingInput({ attendeeEmails: ['alice@corp.com', 'invalid-email'] }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  // ─── 5. Schedule Validation ───
  it('rejects when start time is in the past', async () => {
    const pastStart = new Date(Date.now() - 120_000); // 2 minutes ago
    const futureEnd = new Date(Date.now() + 3600_000);
    await expect(
      service.execute(
        'user-1',
        'host@enterprise.com',
        validMeetingInput({ scheduledStartTime: pastStart, scheduledEndTime: futureEnd }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  it('rejects when end time is before start time', async () => {
    const { start, end } = getFutureDates();
    await expect(
      service.execute(
        'user-1',
        'host@enterprise.com',
        validMeetingInput({ scheduledStartTime: end, scheduledEndTime: start }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when end time equals start time', async () => {
    const { start } = getFutureDates();
    await expect(
      service.execute(
        'user-1',
        'host@enterprise.com',
        validMeetingInput({ scheduledStartTime: start, scheduledEndTime: start }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ─── 6. Duplicate Meeting Validation ───
  it('rejects a duplicate meeting (same host, title, start time)', async () => {
    meetings.findDuplicate.mockResolvedValue(makeMeeting());
    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput()),
    ).rejects.toThrow(ConflictException);
    expect(meetings.create).not.toHaveBeenCalled();
  });

  // ─── 7. Google Meet URL Resolution ───
  it('rejects a malformed custom Google Meet URL', async () => {
    await expect(
      service.execute(
        'user-1',
        'host@enterprise.com',
        validMeetingInput({ customMeetingUrl: 'https://zoom.us/j/123456789' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('auto-generates a Google Meet URL when none is provided', async () => {
    meetings.create.mockResolvedValue(makeMeeting());

    await service.execute('user-1', 'host@enterprise.com', validMeetingInput());

    const createCall = meetings.create.mock.calls[0][0];
    expect(createCall.meetingUrl).toMatch(/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(createCall.meetingCode).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
  });

  it('uses the provided custom Google Meet URL', async () => {
    const customUrl = 'https://meet.google.com/xyz-abcd-efg';
    meetings.create.mockResolvedValue(makeMeeting({ meetingUrl: customUrl, meetingCode: 'xyz-abcd-efg' }));

    await service.execute(
      'user-1',
      'host@enterprise.com',
      validMeetingInput({ customMeetingUrl: customUrl }),
    );

    const createCall = meetings.create.mock.calls[0][0];
    expect(createCall.meetingUrl).toBe(customUrl);
    expect(createCall.meetingCode).toBe('xyz-abcd-efg');
  });

  // ─── 8. Successful Creation & Audit ───
  it('creates the meeting and writes a real audit entry when all fields are complete', async () => {
    meetings.create.mockResolvedValue(makeMeeting());

    const result = await service.execute(
      'user-1',
      'host@enterprise.com',
      validMeetingInput({
        title: '  Sprint Review — Project Phoenix  ',
        description: '  Review of sprint goals and backlog items  ',
        projectId: 'proj-1',
        attendeeEmails: ['Alice@Corp.com', 'BOB@CORP.COM'],
      }),
    );

    expect(meetings.create).toHaveBeenCalledTimes(1);
    const createCall = meetings.create.mock.calls[0][0];
    expect(createCall.title).toBe('Sprint Review — Project Phoenix');
    expect(createCall.description).toBe('Review of sprint goals and backlog items');
    expect(createCall.projectId).toBe('proj-1');
    expect(createCall.attendeeEmails).toEqual(['alice@corp.com', 'bob@corp.com']);

    expect(audit.append).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        action: 'MEETING_ROOM_CREATED',
        resourceType: 'MEETING',
        resourceId: result.id,
      }),
    );
  });

  it('does NOT write an audit entry if create fails', async () => {
    meetings.create.mockRejectedValue(new Error('DB connection lost'));

    await expect(
      service.execute('user-1', 'host@enterprise.com', validMeetingInput()),
    ).rejects.toThrow('DB connection lost');

    expect(audit.append).not.toHaveBeenCalled();
  });
});

describe('ListMeetingsService (UC-43)', () => {
  let meetings: jest.Mocked<MeetingRepository>;
  let service: ListMeetingsService;

  beforeEach(() => {
    meetings = {
      create: jest.fn(),
      findById: jest.fn(),
      listByHost: jest.fn(),
      list: jest.fn(),
      findDuplicate: jest.fn(),
    } as unknown as jest.Mocked<MeetingRepository>;
    service = new ListMeetingsService(meetings);
  });

  it('returns a paginated list of meetings', async () => {
    const items = [makeMeeting(), makeMeeting({ id: 'meeting-2', title: 'Other Meeting' })];
    meetings.list.mockResolvedValue({ items, total: 2 });

    const result = await service.execute({ page: 1, limit: 20 });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(meetings.list).toHaveBeenCalledWith({ page: 1, limit: 20, status: undefined });
  });

  it('passes status filter through to repository', async () => {
    meetings.list.mockResolvedValue({ items: [], total: 0 });

    await service.execute({ status: MeetingStatus.SCHEDULED });

    expect(meetings.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: MeetingStatus.SCHEDULED }),
    );
  });
});
