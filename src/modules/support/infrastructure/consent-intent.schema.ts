import { Schema, Types } from 'mongoose';
import type { SyntheticConsentIntentRegistration } from '../application/consent-intent-persistence.port';
import type { AuthorityRevisionReference } from '../domain/ticket-consent-boundary.contracts';

export const CONSENT_INTENT_CHALLENGE_MODEL = 'SyntheticConsentIntentChallenge';
export const CONSENT_INTENT_TRUST_MODEL = 'SyntheticConsentIntentTrust';
export const CONSENT_INTENT_RECEIPT_MODEL = 'SyntheticConsentIntentReceipt';
export const CONSENT_INTENT_AUDIT_TYPE = 'CONSENT_INTENT_CONSUMPTION';
export const CONSENT_INTENT_AUDIT_ACTION = 'CUSTOMER_CONSENT_INTENT_CONSUMED';
export const CONSENT_INTENT_TRUST_MODE = 'SYNTHETIC_ONLY' as const;

export interface ConsentIntentContextFields {
  schemaVersion: 1;
  trustMode: typeof CONSENT_INTENT_TRUST_MODE;
  organizationId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  ticketId: string;
  episodeId: string;
  verificationAttemptId: string;
  proofIssuerId: string;
  proofId: string;
  nonceSha256: string;
  contextHash: string;
  registration: SyntheticConsentIntentRegistration;
  registeredAtMs: number;
}
export interface ConsentIntentChallengeSnapshot extends ConsentIntentContextFields {
  _id: string;
  state: 'ISSUED' | 'CONSUMED' | 'REVOKED';
  revision: number;
  consumptionId: string | null;
  consumedAtMs: number | null;
}
export interface ConsentIntentReceiptSnapshot extends ConsentIntentContextFields {
  _id: string;
  challengeId: string;
  state: 'CONSUMED';
  revision: 1;
  consumedAtMs: number;
  auditId: Types.ObjectId;
}
export type ConsentIntentTrustKind = 'POLICY' | 'PERSON' | 'ORGANISATION_AUTHORITY' | 'CREDENTIAL';
export interface ConsentIntentTrustSnapshot {
  _id: string;
  schemaVersion: 1;
  trustMode: typeof CONSENT_INTENT_TRUST_MODE;
  kind: ConsentIntentTrustKind;
  reference: AuthorityRevisionReference;
  payload: object;
  payloadHash: string;
  state: 'CURRENT' | 'REVOKED';
  fence: number;
}

export interface ConsentIntentIndex {
  readonly name: string;
  readonly key: Record<string, 1>;
  readonly partialFilterExpression?: Record<string, string>;
}
export const CONSENT_INTENT_CHALLENGE_INDEXES: readonly ConsentIntentIndex[] = [
  { name: 'intent_challenge_nonce_unique', key: { nonceSha256: 1 } },
];
export const CONSENT_INTENT_RECEIPT_INDEXES: readonly ConsentIntentIndex[] = [
  { name: 'intent_receipt_challenge_unique', key: { challengeId: 1 } },
  { name: 'intent_receipt_attempt_unique', key: { verificationAttemptId: 1 } },
  // Deliberately excludes Organisation, action, revision and generation.
  { name: 'intent_receipt_proof_global_unique', key: { proofIssuerId: 1, proofId: 1 } },
  { name: 'intent_receipt_nonce_unique', key: { nonceSha256: 1 } },
  { name: 'intent_receipt_audit_unique', key: { auditId: 1 } },
];
export const CONSENT_INTENT_AUDIT_INDEX: ConsentIntentIndex = {
  name: 'intent_consumption_audit_unique',
  key: { resourceType: 1, resourceId: 1 },
  partialFilterExpression: { resourceType: CONSENT_INTENT_AUDIT_TYPE },
};

const context = {
  schemaVersion: { type: Number, required: true, enum: [1], immutable: true },
  trustMode: { type: String, required: true, enum: [CONSENT_INTENT_TRUST_MODE], immutable: true },
  organizationId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  actorUserId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  ticketId: { type: String, required: true, immutable: true },
  episodeId: { type: String, required: true, immutable: true },
  verificationAttemptId: { type: String, required: true, immutable: true },
  proofIssuerId: { type: String, required: true, immutable: true },
  proofId: { type: String, required: true, immutable: true },
  nonceSha256: { type: String, required: true, immutable: true },
  contextHash: { type: String, required: true, immutable: true },
  // E5A's exact nested shape is enforced by the raw BSON mapper, not casting/defaults.
  registration: { type: Schema.Types.Mixed, required: true, immutable: true },
  registeredAtMs: { type: Number, required: true, immutable: true },
};
const options = {
  timestamps: false as const,
  versionKey: false as const,
  strict: 'throw' as const,
  minimize: false,
};
export const ConsentIntentChallengeSchema = new Schema<ConsentIntentChallengeSnapshot>(
  {
    _id: { type: String, required: true, immutable: true },
    ...context,
    state: { type: String, required: true, enum: ['ISSUED', 'CONSUMED', 'REVOKED'] },
    revision: { type: Number, required: true, validate: Number.isSafeInteger },
    consumptionId: { type: String, default: null },
    consumedAtMs: { type: Number, default: null },
  },
  { ...options, collection: 'synthetic_consent_intent_challenges' },
);
export const ConsentIntentReceiptSchema = new Schema<ConsentIntentReceiptSnapshot>(
  {
    _id: { type: String, required: true, immutable: true },
    ...context,
    challengeId: { type: String, required: true, immutable: true },
    state: { type: String, required: true, enum: ['CONSUMED'], immutable: true },
    revision: { type: Number, required: true, enum: [1], immutable: true },
    consumedAtMs: { type: Number, required: true, immutable: true },
    auditId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  },
  { ...options, collection: 'synthetic_consent_intent_receipts' },
);
export const ConsentIntentTrustSchema = new Schema<ConsentIntentTrustSnapshot>(
  {
    _id: { type: String, required: true, immutable: true },
    schemaVersion: { type: Number, required: true, enum: [1] },
    trustMode: { type: String, required: true, enum: [CONSENT_INTENT_TRUST_MODE] },
    kind: {
      type: String,
      required: true,
      enum: ['POLICY', 'PERSON', 'ORGANISATION_AUTHORITY', 'CREDENTIAL'],
    },
    reference: { type: Schema.Types.Mixed, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    state: { type: String, required: true, enum: ['CURRENT', 'REVOKED'] },
    fence: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  },
  { ...options, collection: 'synthetic_consent_intent_trust' },
);
for (const index of CONSENT_INTENT_CHALLENGE_INDEXES)
  ConsentIntentChallengeSchema.index(index.key, {
    name: index.name,
    unique: true,
    collation: { locale: 'simple' },
  });
for (const index of CONSENT_INTENT_RECEIPT_INDEXES)
  ConsentIntentReceiptSchema.index(index.key, {
    name: index.name,
    unique: true,
    collation: { locale: 'simple' },
  });
