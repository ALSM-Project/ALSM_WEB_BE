import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ManageMeetingService } from '../src/modules/meetings/application/manage-meeting.service';
import { MeetingRepository, MeetingStatus } from '../src/modules/meetings/domain/meeting.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ProjectRepository } from '../src/modules/projects/domain/project.types';

describe('ManageMeetingService (CRUD)', () => {
  let meetings: jest.Mocked<MeetingRepository>;
  let audit: jest.Mocked<AuditRepository>;
  let projects: jest.Mocked<ProjectRepository>;
  let service: ManageMeetingService;

  const mockMeeting = {
    id: '507f1f77bcf86cd799439011',
    title: 'Daily Standup Sync',
    description: 'Daily team sync and blocker review',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    meetingCode: 'abc-defg-hij',
    hostUserId: 'user-1',
    hostEmail: 'lead@alsm.io',
    attendeeEmails: ['dev1@alsm.io', 'dev2@alsm.io'],
    projectId: 'proj-1',
    scheduledStartTime: new Date('2026-11-10T09:00:00Z'),
    scheduledEndTime: new Date('2026-11-10T09:30:00Z'),
    status: MeetingStatus.SCHEDULED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    meetings = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(mockMeeting),
      findDuplicate: jest.fn(),
      listByHost: jest.fn(),
      list: jest.fn(),
      update: jest.fn().mockResolvedValue({ ...mockMeeting, title: 'Updated Title' }),
      delete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<MeetingRepository>;

    audit = { append: jest.fn() } as unknown as jest.Mocked<AuditRepository>;
    projects = {
      findById: jest.fn().mockResolvedValue({ id: 'proj-1', name: 'Phoenix Modernization' }),
    } as unknown as jest.Mocked<ProjectRepository>;

    service = new ManageMeetingService(meetings, audit, projects);
  });

  it('retrieves meeting details by ID with project name', async () => {
    const result = await service.getById('507f1f77bcf86cd799439011');
    expect(result.id).toBe('507f1f77bcf86cd799439011');
    expect(result.projectName).toBe('Phoenix Modernization');
  });

  it('throws NotFoundException when meeting ID is not found', async () => {
    meetings.findById.mockResolvedValue(null);
    await expect(service.getById('non-existent')).rejects.toThrow(NotFoundException);
  });

  it('updates meeting title, agenda, and times with audit trail', async () => {
    const updated = await service.update('507f1f77bcf86cd799439011', 'user-1', {
      title: 'Updated Title',
      description: 'New agenda item',
      scheduledStartTime: '2026-11-10T10:00:00Z',
      scheduledEndTime: '2026-11-10T11:00:00Z',
    });

    expect(meetings.update).toHaveBeenCalled();
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEETING_ROOM_UPDATED' }),
    );
    expect(updated.title).toBe('Updated Title');
  });

  it('rejects invalid end time before start time', async () => {
    await expect(
      service.update('507f1f77bcf86cd799439011', 'user-1', {
        scheduledStartTime: '2026-11-10T11:00:00Z',
        scheduledEndTime: '2026-11-10T10:00:00Z',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates status to IN_PROGRESS, COMPLETED, or CANCELLED', async () => {
    meetings.update.mockResolvedValue({ ...mockMeeting, status: MeetingStatus.IN_PROGRESS });
    const result = await service.updateStatus('507f1f77bcf86cd799439011', 'user-1', 'IN_PROGRESS');
    expect(result.status).toBe(MeetingStatus.IN_PROGRESS);
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEETING_STATUS_CHANGED' }),
    );
  });

  it('deletes meeting and records audit log', async () => {
    const result = await service.delete('507f1f77bcf86cd799439011', 'user-1');
    expect(result.success).toBe(true);
    expect(meetings.delete).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MEETING_ROOM_DELETED' }),
    );
  });
});
