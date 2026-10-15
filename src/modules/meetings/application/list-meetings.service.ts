import { Inject, Injectable } from '@nestjs/common';
import { MEETING_REPOSITORY, MeetingRecord, MeetingRepository, MeetingStatus } from '../domain/meeting.types';

@Injectable()
export class ListMeetingsService {
  constructor(@Inject(MEETING_REPOSITORY) private readonly meetings: MeetingRepository) {}

  async execute(params?: {
    status?: MeetingStatus;
    page?: number;
    limit?: number;
  }): Promise<{ items: MeetingRecord[]; total: number }> {
    return this.meetings.list(params);
  }
}
