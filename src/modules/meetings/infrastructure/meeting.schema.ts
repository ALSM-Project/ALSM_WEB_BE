import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { MeetingStatus } from '../domain/meeting.types';

export type MeetingDocument = Meeting & Document;

@Schema({ collection: 'meetings', timestamps: true })
export class Meeting {
  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, trim: true })
  meetingUrl!: string;

  @Prop({ required: true, trim: true })
  meetingCode!: string;

  @Prop({ trim: true })
  calendarEventId?: string;

  @Prop({ type: Types.ObjectId, required: true })
  hostUserId!: Types.ObjectId;

  @Prop({ required: true, trim: true, lowercase: true })
  hostEmail!: string;

  @Prop({ trim: true })
  projectId?: string;

  @Prop({ type: [String], default: [] })
  attendeeEmails!: string[];

  @Prop({ required: true })
  scheduledStartTime!: Date;

  @Prop({ required: true })
  scheduledEndTime!: Date;

  @Prop({ type: String, enum: MeetingStatus, default: MeetingStatus.SCHEDULED })
  status!: MeetingStatus;

  createdAt!: Date;
  updatedAt!: Date;
}

export const MeetingSchema = SchemaFactory.createForClass(Meeting);
