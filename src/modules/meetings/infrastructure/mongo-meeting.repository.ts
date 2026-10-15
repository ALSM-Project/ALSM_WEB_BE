import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Meeting, MeetingDocument } from './meeting.schema';
import {
  CreateMeetingInput,
  MeetingRecord,
  MeetingRepository,
  MeetingStatus,
} from '../domain/meeting.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoMeetingRepository implements MeetingRepository {
  constructor(@InjectModel(Meeting.name) private readonly model: Model<Meeting>) {}

  async create(input: CreateMeetingInput): Promise<MeetingRecord> {
    const doc = await this.model.create({
      title: input.title,
      description: input.description,
      meetingUrl: input.meetingUrl,
      meetingCode: input.meetingCode,
      calendarEventId: input.calendarEventId,
      hostUserId: toValidObjectId(input.hostUserId),
      hostEmail: input.hostEmail.toLowerCase(),
      projectId: input.projectId,
      attendeeEmails: input.attendeeEmails.map((e) => e.toLowerCase()),
      scheduledStartTime: input.scheduledStartTime,
      scheduledEndTime: input.scheduledEndTime,
      status: MeetingStatus.SCHEDULED,
    });
    return this.map(doc);
  }

  async findById(id: string): Promise<MeetingRecord | null> {
    if (!id || !id.match(/^[a-f\d]{24}$/i)) return null;
    const doc = await this.model.findById(id).exec();
    return doc ? this.map(doc) : null;
  }

  async findDuplicate(hostUserId: string, title: string, scheduledStartTime: Date): Promise<MeetingRecord | null> {
    const doc = await this.model.findOne({
      hostUserId: toValidObjectId(hostUserId),
      title,
      scheduledStartTime,
    }).exec();
    return doc ? this.map(doc) : null;
  }

  async listByHost(hostUserId: string): Promise<MeetingRecord[]> {
    const docs = await this.model
      .find({ hostUserId: toValidObjectId(hostUserId) })
      .sort({ scheduledStartTime: 1 })
      .exec();
    return docs.map((d) => this.map(d));
  }

  async list(params?: {
    status?: MeetingStatus;
    page?: number;
    limit?: number;
  }): Promise<{ items: MeetingRecord[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params?.status) filter['status'] = params.status;
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(100, Math.max(1, params?.limit ?? 20));
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ scheduledStartTime: 1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items: docs.map((d) => this.map(d)), total };
  }

  private map(doc: MeetingDocument): MeetingRecord {
    return {
      id: doc.id as string,
      title: doc.title,
      description: doc.description,
      meetingUrl: doc.meetingUrl,
      meetingCode: doc.meetingCode,
      calendarEventId: (doc as MeetingDocument & { calendarEventId?: string }).calendarEventId,
      hostUserId: doc.hostUserId.toString(),
      hostEmail: doc.hostEmail,
      projectId: doc.projectId,
      attendeeEmails: doc.attendeeEmails,
      scheduledStartTime: doc.scheduledStartTime,
      scheduledEndTime: doc.scheduledEndTime,
      status: doc.status,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
