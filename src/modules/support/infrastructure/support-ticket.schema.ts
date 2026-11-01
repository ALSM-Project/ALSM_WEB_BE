import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import type {
  SupportTicketDecisionReferences,
  SupportTicketEpisode,
  SupportTicketStatus,
} from '../domain/support-ticket.types';
import { supportTicketFromSnapshot } from './support-ticket.mapper';

const episodeSchema = new MongoSchema(
  {
    episodeId: { type: String, required: true },
    openedAt: { type: Date, required: true },
    openedBy: { type: String, required: true },
    endedAt: { type: Date },
    endedBy: { type: String },
    outcome: { type: String, enum: ['CLOSED', 'CANCELLED', null] },
  },
  { _id: false, strict: 'throw' },
);
const referenceSchema = new MongoSchema(
  {
    authorityId: { type: String, required: true },
    evidenceId: { type: String, required: true },
    revision: { type: String, required: true },
    generation: { type: String, required: true },
  },
  { _id: false, strict: 'throw' },
);
const decisionsSchema = new MongoSchema(
  {
    ticketId: { type: String, required: true },
    organizationId: { type: String, required: true },
    episodeId: { type: String, required: true },
    customerConsent: { type: referenceSchema },
    internalApproval: { type: referenceSchema },
  },
  { _id: false, strict: 'throw' },
);

@Schema({ collection: 'support_tickets', timestamps: false, versionKey: false, strict: 'throw' })
export class SupportTicket {
  // Ticket IDs are domain strings (server-generated UUIDs), not BSON ObjectIds.
  @Prop({ type: String, required: true, immutable: true }) _id!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  organizationId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, immutable: true })
  requesterUserId!: Types.ObjectId;
  @Prop({ type: String, required: true, immutable: true }) purposeId!: string;
  @Prop({ type: String, enum: ['OPEN', 'CLOSED', 'CANCELLED'], required: true })
  status!: SupportTicketStatus;
  @Prop({ type: Number, required: true, min: 0, validate: Number.isSafeInteger }) revision!: number;
  @Prop({ type: String, required: true }) episodeId!: string;
  @Prop({ type: [episodeSchema], required: true, default: undefined })
  episodes!: SupportTicketEpisode[];
  @Prop({ type: decisionsSchema }) decisionReferences!: SupportTicketDecisionReferences | null;
  @Prop({ type: Date, required: true, immutable: true }) createdAt!: Date;
  @Prop({ type: Date, required: true }) updatedAt!: Date;
}
export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
// MongoDB's mandatory _id_ index is the unique Ticket-ID fence.
SupportTicketSchema.index({ organizationId: 1, _id: 1 });
SupportTicketSchema.pre('validate', function () {
  supportTicketFromSnapshot(this.toObject());
});
