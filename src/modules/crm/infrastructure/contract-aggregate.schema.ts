import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { ContractActivationStatus, ContractFinalEvidenceArtifact, ContractLifecycleStatus, ContractReviewStatus, ContractVersionReviewStatus } from '../domain/contract-aggregate.types';

@Schema({ _id: false })
class ContractReviewDocumentArtifact {
  @Prop({ required: true, enum: ['REVIEW_COPY'] }) kind!: 'REVIEW_COPY';
  @Prop({ required: true }) storageReference!: string;
  @Prop({ required: true, maxlength: 180 }) fileName!: string;
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) sha256!: string;
  @Prop({ required: true, min: 1 }) byteLength!: number;
  @Prop({ required: true, enum: ['AES-256-GCM'] }) encryption!: 'AES-256-GCM';
  @Prop({ required: true }) encryptionKeyVersion!: string;
  @Prop({ required: true, maxlength: 40 }) rendererVersion!: string;
  @Prop({ required: true }) generatedAt!: Date;
}
const ContractReviewDocumentArtifactSchema = SchemaFactory.createForClass(ContractReviewDocumentArtifact);

@Schema({ _id: false })
class ContractCanonicalDocumentArtifact {
  @Prop({ required: true, enum: ['CANONICAL_UNSIGNED'] }) kind!: 'CANONICAL_UNSIGNED';
  @Prop({ required: true }) storageReference!: string;
  @Prop({ required: true, maxlength: 180 }) fileName!: string;
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) sha256!: string;
  @Prop({ required: true, min: 1 }) byteLength!: number;
  @Prop({ required: true, enum: ['AES-256-GCM'] }) encryption!: 'AES-256-GCM';
  @Prop({ required: true }) encryptionKeyVersion!: string;
  @Prop({ required: true, maxlength: 40 }) rendererVersion!: string;
  @Prop({ required: true }) generatedAt!: Date;
}
const ContractCanonicalDocumentArtifactSchema = SchemaFactory.createForClass(ContractCanonicalDocumentArtifact);

@Schema({ _id: false })
class ContractFinalEvidenceArtifactRecord implements ContractFinalEvidenceArtifact {
  @Prop({ type: String, required: true, enum: ['SIGNED_PDF', 'COMPLETION_CERTIFICATE', 'AUDIT_TRAIL'] }) kind!: ContractFinalEvidenceArtifact['kind'];
  @Prop({ required: true }) storageReference!: string;
  @Prop({ required: true, maxlength: 180 }) fileName!: string;
  @Prop({ type: String, required: true, enum: ['application/pdf', 'application/json', 'text/plain'] }) mimeType!: ContractFinalEvidenceArtifact['mimeType'];
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) sha256!: string;
  @Prop({ required: true, min: 1 }) byteLength!: number;
  @Prop({ required: true, enum: ['AES-256-GCM'] }) encryption!: 'AES-256-GCM';
  @Prop({ required: true }) encryptionKeyVersion!: string;
  @Prop({ required: true }) archivedAt!: Date;
}
const ContractFinalEvidenceArtifactSchema = SchemaFactory.createForClass(ContractFinalEvidenceArtifactRecord);

@Schema({ _id: false })
class ContractFinalEvidenceManifestRecord {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) contractVersionId!: Types.ObjectId;
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) canonicalDocumentSha256!: string;
  @Prop({ required: true, maxlength: 80 }) providerKey!: string;
  @Prop({ required: true, maxlength: 240 }) providerEnvelopeReference!: string;
  @Prop({ required: true, maxlength: 240 }) providerCompletionEventReference!: string;
  @Prop({ required: true }) providerCompletedAt!: Date;
  @Prop({ required: true }) archivedAt!: Date;
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) manifestSha256!: string;
  @Prop({ type: ContractFinalEvidenceArtifactSchema, required: true }) signedPdf!: ContractFinalEvidenceArtifactRecord;
  @Prop({ type: [ContractFinalEvidenceArtifactSchema], default: [] }) supportingArtifacts!: ContractFinalEvidenceArtifactRecord[];
}
const ContractFinalEvidenceManifestSchema = SchemaFactory.createForClass(ContractFinalEvidenceManifestRecord);

@Schema({ _id: false })
class ContractDemoSigningSessionRecord {
  @Prop({ required: true, maxlength: 240 }) providerEnvelopeReference!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) contractVersionId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) customerUserId!: Types.ObjectId;
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) canonicalDocumentSha256!: string;
  @Prop({ required: true, enum: ['SENT', 'COMPLETED'] }) status!: 'SENT' | 'COMPLETED';
  @Prop({ required: true }) startedAt!: Date;
  @Prop({ required: true }) expiresAt!: Date;
  @Prop() completedAt?: Date;
  @Prop({ maxlength: 240 }) completionEventReference?: string;
}
const ContractDemoSigningSessionSchema = SchemaFactory.createForClass(ContractDemoSigningSessionRecord);

@Schema({ _id: false })
class ContractProviderSigningSessionRecord {
  @Prop({ required: true, maxlength: 80 }) providerKey!: string;
  @Prop({ required: true, maxlength: 240, index: true }) providerEnvelopeReference!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) contractVersionId!: Types.ObjectId;
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) canonicalDocumentSha256!: string;
  @Prop({ required: true, enum: ['SENT', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'CANCELLED', 'EXPIRED'] })
  status!: 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  @Prop({ required: true }) startedAt!: Date;
  @Prop({ required: true }) expiresAt!: Date;
  @Prop() completedAt?: Date;
  @Prop({ maxlength: 240 }) completionEventReference?: string;
  @Prop() lastEventAt?: Date;
}
const ContractProviderSigningSessionSchema = SchemaFactory.createForClass(ContractProviderSigningSessionRecord);

@Schema({ _id: false })
class ContractTemplateSectionSnapshot {
  @Prop({ required: true, maxlength: 120 }) heading!: string;
  @Prop({ required: true, maxlength: 20000 }) body!: string;
}
const ContractTemplateSectionSnapshotSchema = SchemaFactory.createForClass(ContractTemplateSectionSnapshot);

@Schema({ _id: false })
class ApprovedContractTemplateSnapshot {
  @Prop({ required: true }) templateVersionId!: string;
  @Prop({ required: true, min: 1 }) templateVersionNumber!: number;
  @Prop({ required: true, maxlength: 160 }) title!: string;
  @Prop({ required: true, enum: ['vi', 'en', 'vi-en'] }) locale!: 'vi' | 'en' | 'vi-en';
  @Prop({ required: true, match: /^[a-f\d]{64}$/ }) contentDigest!: string;
  @Prop({ type: [ContractTemplateSectionSnapshotSchema], required: true }) sections!: ContractTemplateSectionSnapshot[];
}
const ApprovedContractTemplateSnapshotSchema = SchemaFactory.createForClass(ApprovedContractTemplateSnapshot);

@Schema({ collection: 'contracts', timestamps: true })
export class ContractAggregate {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) leadId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) organizationId!: Types.ObjectId;
  @Prop({ required: true, unique: true }) contractNumber!: string;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) currentVersionId!: Types.ObjectId;
  @Prop({ required: true, enum: [
    'DRAFT', 'INTERNAL_REVIEW', 'READY_FOR_SIGNATURE', 'ALSM_SIGNING_IN_PROGRESS',
    'ALSM_PARTIALLY_SIGNED', 'ALSM_SIGNED', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED',
    'CUSTOMER_SIGNING_IN_PROGRESS', 'CUSTOMER_PARTIALLY_SIGNED', 'CUSTOMER_SIGNED',
    'CHANGES_REQUESTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'PROVIDER_ERROR',
    'PROVIDER_COMPLETED_EVIDENCE_PENDING', 'PROVIDER_COMPLETED_EVIDENCE_FAILED',
    'COMPLETED', 'LEGACY_UNVERIFIED',
  ], default: 'DRAFT', index: true }) lifecycleStatus!: ContractLifecycleStatus;
  @Prop({ required: true, enum: ['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'], default: 'NOT_SUBMITTED' })
  reviewStatus!: ContractReviewStatus;
  @Prop({ required: true, enum: ['NOT_STARTED', 'CONFIRMED'], default: 'NOT_STARTED' })
  providerCompletionStatus!: 'NOT_STARTED' | 'CONFIRMED';
  @Prop({ required: true, enum: ['NOT_STARTED', 'PENDING', 'VERIFIED', 'FAILED'], default: 'NOT_STARTED' })
  archiveStatus!: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'FAILED';
  @Prop({ type: ContractFinalEvidenceManifestSchema }) finalEvidence?: ContractFinalEvidenceManifestRecord;
  @Prop({ type: ContractDemoSigningSessionSchema }) demoSigningSession?: ContractDemoSigningSessionRecord;
  @Prop({ type: ContractProviderSigningSessionSchema }) providerSigningSession?: ContractProviderSigningSessionRecord;
  @Prop({ required: true, enum: ['NOT_ELIGIBLE', 'ELIGIBLE', 'REQUESTED', 'COMPLETED', 'FAILED_RETRYABLE', 'RECONCILIATION_REQUIRED'], default: 'NOT_ELIGIBLE' })
  activationStatus!: ContractActivationStatus;
  @Prop({ type: MongoSchema.Types.ObjectId }) customerUserId?: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) createdByUserId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId }) submittedByUserId?: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId }) reviewedByUserId?: Types.ObjectId;
  @Prop() reviewedAt?: Date;
  @Prop({ maxlength: 1000 }) reviewReason?: string;
  @Prop({ required: true, enum: ['NONE', 'CHANGES_REQUESTED', 'DECLINED'], default: 'NONE' }) customerDecision!: 'NONE' | 'CHANGES_REQUESTED' | 'DECLINED';
  @Prop({ type: MongoSchema.Types.ObjectId }) customerDecisionByUserId?: Types.ObjectId;
  @Prop() customerDecisionAt?: Date;
  @Prop({ maxlength: 1000 }) customerDecisionReason?: string;
  @Prop({ required: true }) createRequestId!: string;
  @Prop({ required: true }) createRequestFingerprint!: string;
  @Prop({ required: true }) revision!: number;
  @Prop() completedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractAggregateDocument = HydratedDocument<ContractAggregate>;
export const ContractAggregateSchema = SchemaFactory.createForClass(ContractAggregate);
ContractAggregateSchema.index(
  { leadId: 1, createdByUserId: 1, createRequestId: 1 },
  { unique: true, name: 'contract_create_idempotency' },
);
ContractAggregateSchema.index({ leadId: 1, createdAt: -1 }, { name: 'contracts_by_lead' });
ContractAggregateSchema.index(
  { leadId: 1, lifecycleStatus: 1, providerCompletionStatus: 1, archiveStatus: 1, activationStatus: 1 },
  { name: 'contract_activation_gate' },
);

@Schema({ collection: 'contract_versions', timestamps: true })
export class ContractVersion {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true, index: true }) contractId!: Types.ObjectId;
  @Prop({ required: true, min: 1 }) versionNumber!: number;
  @Prop({ required: true, enum: ['DRAFT', 'INTERNAL_REVIEW', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] })
  reviewStatus!: ContractVersionReviewStatus;
  @Prop({ required: true, maxlength: 200 }) title!: string;
  @Prop({ required: true, maxlength: 100 }) plan!: string;
  @Prop({ maxlength: 100 }) quoteId?: string;
  @Prop({ required: true, min: 1 }) annualValue!: number;
  @Prop({ required: true, enum: ['VND'], default: 'VND' }) currency!: 'VND';
  @Prop({ required: true, match: /^\d{4}-\d{2}-\d{2}$/ }) effectiveDate!: string;
  @Prop({ required: true }) customerName!: string;
  @Prop({ required: true }) customerContactName!: string;
  @Prop({ required: true }) customerEmail!: string;
  @Prop({ required: true }) createdByUserId!: Types.ObjectId;
  @Prop() revisionRequestId?: string;
  @Prop() revisionRequestFingerprint?: string;
  @Prop() submittedAt?: Date;
  @Prop() approvedAt?: Date;
  @Prop() approvedByUserId?: Types.ObjectId;
  @Prop() returnedAt?: Date;
  @Prop() returnReason?: string;
  /** Set only after an approved legal template/version is configured. No provider uses this field yet. */
  @Prop() approvedTemplateVersionId?: string;
  /** Immutable approved legal text copied into the contract version for later rendering and verification. */
  @Prop({ type: ApprovedContractTemplateSnapshotSchema }) approvedTemplateSnapshot?: ApprovedContractTemplateSnapshot;
  /** A content digest is integrity metadata only and is not signature evidence. */
  @Prop() contentDigest?: string;
  @Prop({ type: ContractCanonicalDocumentArtifactSchema }) canonicalDocument?: ContractCanonicalDocumentArtifact;
  @Prop({ type: ContractReviewDocumentArtifactSchema }) reviewDocument?: ContractReviewDocumentArtifact;
  createdAt!: Date;
  updatedAt!: Date;
}

export type ContractVersionDocument = HydratedDocument<ContractVersion>;
export const ContractVersionSchema = SchemaFactory.createForClass(ContractVersion);
ContractVersionSchema.index(
  { contractId: 1, versionNumber: 1 },
  { unique: true, name: 'contract_version_number_unique' },
);
ContractVersionSchema.index({ contractId: 1, createdAt: -1 }, { name: 'contract_versions_by_contract' });
ContractVersionSchema.index(
  { contractId: 1, createdByUserId: 1, revisionRequestId: 1 },
  { unique: true, name: 'contract_version_revision_idempotency', partialFilterExpression: { revisionRequestId: { $exists: true } } },
);
