import { Schema, Types } from 'mongoose';
import { SupportContextProps } from '../domain/support-context.entity';

export const SUPPORT_CONTEXT_MODEL = 'SupportContext';
export const SUPPORT_ACTIVE_ORIGIN_INDEX = 'support_context_active_origin_unique';
export type SupportContextSnapshot = Omit<
  SupportContextProps,
  'id' | 'actorUserId' | 'originalSessionId' | 'organizationId'
> & {
  _id: string;
  actorUserId: Types.ObjectId;
  originalSessionId: Types.ObjectId;
  organizationId: Types.ObjectId;
};

export const SupportContextSchema = new Schema<SupportContextSnapshot>(
  {
    _id: { type: String, required: true, immutable: true },
    actorUserId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    originalSessionId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    sessionVersion: { type: String, required: true, immutable: true },
    authorityBinding: { type: String, required: true, immutable: true },
    audience: { type: String, required: true, enum: ['UC66'], immutable: true },
    readOnly: {
      type: Boolean,
      required: true,
      validate: (value: boolean) => value === true,
      immutable: true,
    },
    policyReference: { type: String, required: true, immutable: true },
    state: { type: String, required: true, enum: ['ACTIVE', 'EXITED', 'EXPIRED', 'REVOKED'] },
    revision: { type: Number, required: true },
    createdAt: { type: Date, required: true, immutable: true },
    lastActivityAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true, immutable: true },
    endedAt: { type: Date, default: null },
  },
  { collection: 'support_contexts', timestamps: false, versionKey: false, strict: 'throw' },
);

// Retain terminal contexts for audit/reconciliation; deliberately no TTL index.
SupportContextSchema.index(
  { actorUserId: 1, originalSessionId: 1 },
  {
    name: SUPPORT_ACTIVE_ORIGIN_INDEX,
    unique: true,
    partialFilterExpression: { state: 'ACTIVE' },
  },
);
