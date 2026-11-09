import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  ConsultationType,
  CustomerType,
  MeetingFormat,
  MeetingPriority,
  MeetingRequestStatus,
  ProposedSlot,
  MeetingInternalNote,
  MeetingCommunicationLog,
  MeetingHistoryEntry,
  MeetingOutcome,
} from '../domain/meeting-request.types';

export type MeetingRequestDocument = HydratedDocument<MeetingRequest>;

@Schema({ _id: false })
export class CustomerInfo {
  @Prop({ required: true, trim: true }) fullName!: string;
  @Prop({ required: true, trim: true }) companyName!: string;
  @Prop({ required: true, trim: true, lowercase: true }) email!: string;
  @Prop({ trim: true }) phone?: string;
  @Prop({ enum: CustomerType, default: CustomerType.PROSPECT }) customerType!: CustomerType;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) userId?: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Organization' }) organizationId?: Types.ObjectId;
}

@Schema({ _id: false })
export class ConsultationRequirements {
  @Prop({ enum: ['ALSM_MANAGED', 'CUSTOMER_SELF_SERVICE', 'HYBRID'], default: 'ALSM_MANAGED' })
  serviceMode!: 'ALSM_MANAGED' | 'CUSTOMER_SELF_SERVICE' | 'HYBRID';

  @Prop({ trim: true, default: 'IBM 3270 BMS' }) legacySystemType!: string;
  @Prop({ trim: true }) currentTechnology?: string;
  @Prop({ type: Number, default: 0 }) estimatedScreens!: number;
  @Prop({ type: Number, default: 0 }) estimatedPrograms!: number;
  @Prop({ enum: ['SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE'], default: 'MEDIUM' })
  estimatedProjectScale!: 'SMALL' | 'MEDIUM' | 'LARGE' | 'ENTERPRISE';

  @Prop({ trim: true }) businessRequirements?: string;
  @Prop({ trim: true }) technicalRequirements?: string;
  @Prop({ trim: true }) expectedTimeline?: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project' }) projectId?: Types.ObjectId;
  @Prop({ trim: true }) projectName?: string;
}

@Schema({ _id: false })
export class MeetingScheduling {
  @Prop({ trim: true }) requestedDate?: string;
  @Prop({ trim: true }) requestedTime?: string;
  @Prop({ trim: true, default: 'Asia/Ho_Chi_Minh' }) timezone!: string;

  @Prop({ type: [Object], default: [] }) proposedSlots!: ProposedSlot[];

  @Prop() scheduledStartTime?: Date;
  @Prop() scheduledEndTime?: Date;
  @Prop({ type: Number, default: 45 }) durationMinutes!: number;

  @Prop({ enum: MeetingFormat, default: MeetingFormat.GOOGLE_MEET }) format!: MeetingFormat;
  @Prop({ trim: true }) meetingUrl?: string;
  @Prop({ trim: true }) meetingCode?: string;
  @Prop({ trim: true }) calendarEventId?: string;
  @Prop({ enum: ['CONNECTED', 'UNCONFIGURED', 'FAILED', 'MANUAL'], default: 'UNCONFIGURED' })
  calendarIntegrationStatus!: 'CONNECTED' | 'UNCONFIGURED' | 'FAILED' | 'MANUAL';
  @Prop({ type: [String], default: [] }) attendeeEmails!: string[];
}

@Schema({ _id: false })
export class SalesAssignment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) assignedSalesId?: Types.ObjectId;
  @Prop({ trim: true }) assignedSalesName?: string;
  @Prop({ trim: true }) assignedSalesEmail?: string;
  @Prop() assignedAt?: Date;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' }) assignedBy?: Types.ObjectId;
}

@Schema({ collection: 'meeting_requests', timestamps: true })
export class MeetingRequest {
  @Prop({ required: true, unique: true, trim: true })
  requestId!: string; // e.g. MTR-2026-0001

  @Prop({ type: CustomerInfo, required: true })
  customer!: CustomerInfo;

  @Prop({ required: true, trim: true })
  topic!: string;

  @Prop({ enum: ConsultationType, default: ConsultationType.SALES_SERVICE, index: true })
  consultationType!: ConsultationType;

  @Prop({ enum: MeetingPriority, default: MeetingPriority.MEDIUM, index: true })
  priority!: MeetingPriority;

  @Prop({ enum: MeetingRequestStatus, default: MeetingRequestStatus.NEW_REQUEST, index: true })
  status!: MeetingRequestStatus;

  @Prop({ trim: true })
  statusReason?: string;

  @Prop({ type: ConsultationRequirements, default: () => ({}) })
  requirements!: ConsultationRequirements;

  @Prop({ type: MeetingScheduling, default: () => ({}) })
  scheduling!: MeetingScheduling;

  @Prop({ type: SalesAssignment, default: () => ({}) })
  assignment!: SalesAssignment;

  @Prop({ type: [Object], default: [] })
  internalNotes!: MeetingInternalNote[];

  @Prop({ type: [Object], default: [] })
  communicationHistory!: MeetingCommunicationLog[];

  @Prop({ type: [Object], default: [] })
  meetingHistory!: MeetingHistoryEntry[];

  @Prop({ type: Object })
  outcome?: MeetingOutcome;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Lead', index: true })
  relatedLeadId?: Types.ObjectId;

  @Prop({ trim: true })
  relatedOpportunityId?: string;

  @Prop({ trim: true })
  relatedQuoteId?: string;

  @Prop({ trim: true })
  relatedContractId?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'QuoteRequest' })
  legacyQuoteRequestId?: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const MeetingRequestSchema = SchemaFactory.createForClass(MeetingRequest);
MeetingRequestSchema.index({ 'customer.email': 1 });
MeetingRequestSchema.index({ 'customer.companyName': 1 });
MeetingRequestSchema.index({ 'assignment.assignedSalesId': 1, status: 1 });
MeetingRequestSchema.index({ status: 1, createdAt: -1 });
