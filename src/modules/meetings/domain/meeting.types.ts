export enum MeetingStatus {
  SCHEDULED = 'SCHEDULED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface MeetingRecord {
  id: string;
  title: string;
  description?: string;
  meetingUrl: string;
  meetingCode: string;
  calendarEventId?: string;
  hostUserId: string;
  hostEmail: string;
  projectId?: string;
  attendeeEmails: string[];
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  status: MeetingStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMeetingInput {
  title: string;
  description?: string;
  meetingUrl: string;
  meetingCode: string;
  calendarEventId?: string;
  customMeetingUrl?: string;
  projectId?: string;
  attendeeEmails: string[];
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  hostUserId: string;
  hostEmail: string;
}

export interface MeetingRepository {
  create(input: CreateMeetingInput): Promise<MeetingRecord>;
  findById(id: string): Promise<MeetingRecord | null>;
  findDuplicate(hostUserId: string, title: string, scheduledStartTime: Date): Promise<MeetingRecord | null>;
  listByHost(hostUserId: string): Promise<MeetingRecord[]>;
  list(params?: { status?: MeetingStatus; page?: number; limit?: number }): Promise<{ items: MeetingRecord[]; total: number }>;
}

export const MEETING_REPOSITORY = Symbol('MEETING_REPOSITORY');
