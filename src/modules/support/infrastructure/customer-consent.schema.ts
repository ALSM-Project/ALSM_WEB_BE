import { Schema, Types } from 'mongoose';
import type { CustomerConsentProps } from '../domain/customer-consent.types';
import { customerConsentFromSnapshot } from './customer-consent.mapper';

export type CustomerConsentSnapshot = Omit<
  CustomerConsentProps,
  'consentId' | 'organizationId' | 'createdByUserId' | 'updatedByUserId'
> & {
  _id: string;
  organizationId: Types.ObjectId;
  createdByUserId: Types.ObjectId;
  updatedByUserId: Types.ObjectId;
};
export const CUSTOMER_CONSENT_MODEL = 'CustomerConsent';
export const CUSTOMER_CONSENT_SOURCE_INDEX_NAME = 'consent_source_event_scope_unique';
export const CUSTOMER_CONSENT_SOURCE_INDEX = {
  organizationId: 1,
  ticketId: 1,
  episodeId: 1,
  'history.source.authorityId': 1,
  'history.source.evidenceId': 1,
} as const;

const reference = new Schema(
  {
    authorityId: { type: String, required: true },
    evidenceId: { type: String, required: true },
    revision: { type: String, required: true },
    generation: { type: String, required: true },
  },
  { _id: false, strict: 'throw' },
);
const evidence = reference.clone();
evidence.add({
  status: {
    type: String,
    required: true,
    enum: ['CURRENT', 'STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'],
  },
});
const person = new Schema(
  {
    personId: { type: String, required: true },
    accountId: { type: String, required: true },
    provenance: { type: evidence, required: true },
  },
  { _id: false, strict: 'throw' },
);
const scope = new Schema(
  {
    useCase: { type: String, required: true, enum: ['UC66'] },
    purposeId: { type: String, required: true },
    operation: {
      type: String,
      required: true,
      enum: ['UC66_READ_PROJECTS', 'UC66_READ_SCREENS', 'UC66_READ_PROGRAMS', 'UC66_READ_LOGS'],
    },
    projectionId: { type: String, required: true },
    environmentId: { type: String, required: true },
    mode: { type: String, required: true, enum: ['READ_ONLY'] },
  },
  { _id: false, strict: 'throw' },
);
const beneficiary = new Schema(
  {
    identity: { type: person, required: true },
    ordinarySession: { type: evidence, required: true },
    entitlement: { type: evidence, required: true },
  },
  { _id: false, strict: 'throw' },
);
const coverage = new Schema(
  {
    kind: { type: String, required: true, enum: ['INDIVIDUAL'] },
    personId: { type: String, required: true },
    accountId: { type: String, required: true },
  },
  { _id: false, strict: 'throw' },
);
const policy = new Schema(
  {
    policyId: { type: String, required: true },
    version: { type: String, required: true },
    sha256: { type: String, required: true },
    decisionEvidence: { type: evidence, required: true },
  },
  { _id: false, strict: 'throw' },
);
const authority = new Schema(
  {
    kind: { type: String, required: true, enum: ['ORGANIZATION_OWNER'] },
    organizationId: { type: String, required: true },
    evidence: { type: evidence, required: true },
  },
  { _id: false, strict: 'throw' },
);
const event = new Schema(
  {
    revision: { type: Number, required: true },
    from: { type: String, required: true, enum: ['NOT_REQUESTED', 'PENDING_VERIFICATION'] },
    to: { type: String, required: true, enum: ['PENDING_VERIFICATION', 'DECLINED', 'INVALIDATED'] },
    actorUserId: { type: String, required: true },
    source: { type: reference, required: true },
    at: { type: Date, required: true },
    reason: { type: String, enum: ['TICKET_CLOSED', 'TICKET_CANCELLED', 'EPISODE_CHANGED', null] },
  },
  { _id: false, strict: 'throw' },
);

export const CustomerConsentSchema = new Schema<CustomerConsentSnapshot>(
  {
    _id: { type: String, required: true, immutable: true },
    schemaVersion: { type: Number, required: true, immutable: true, enum: [1] },
    ticketId: { type: String, required: true, immutable: true },
    organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    episodeId: { type: String, required: true, immutable: true },
    purposeId: { type: String, required: true, immutable: true },
    scope: { type: scope, required: true, immutable: true },
    beneficiary: { type: beneficiary, required: true, immutable: true },
    coverage: { type: coverage, required: true, immutable: true },
    policy: { type: policy, required: true, immutable: true },
    grantor: { type: person, required: true, immutable: true },
    customerAuthority: { type: authority, required: true, immutable: true },
    requestSource: { type: reference, required: true, immutable: true },
    state: {
      type: String,
      required: true,
      enum: ['PENDING_VERIFICATION', 'DECLINED', 'INVALIDATED'],
    },
    revision: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    createdByUserId: { type: Schema.Types.ObjectId, required: true, immutable: true },
    updatedByUserId: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true, immutable: true },
    updatedAt: { type: Date, required: true },
    history: { type: [event], required: true, default: undefined },
  },
  { collection: 'customer_consents', timestamps: false, versionKey: false, strict: 'throw' },
);

CustomerConsentSchema.index(CUSTOMER_CONSENT_SOURCE_INDEX, {
  name: CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
  unique: true,
  collation: { locale: 'simple' },
});
CustomerConsentSchema.pre('validate', function () {
  customerConsentFromSnapshot(this.toObject());
});
