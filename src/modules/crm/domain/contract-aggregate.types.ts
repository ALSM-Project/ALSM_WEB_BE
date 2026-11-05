export type ContractLifecycleStatus =
  | 'DRAFT' | 'INTERNAL_REVIEW' | 'READY_FOR_SIGNATURE' | 'ALSM_SIGNING_IN_PROGRESS'
  | 'ALSM_PARTIALLY_SIGNED' | 'ALSM_SIGNED' | 'SENT_TO_CUSTOMER' | 'CUSTOMER_VIEWED'
  | 'CUSTOMER_SIGNING_IN_PROGRESS' | 'CUSTOMER_PARTIALLY_SIGNED' | 'CUSTOMER_SIGNED'
  | 'CHANGES_REQUESTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'PROVIDER_ERROR'
  | 'PROVIDER_COMPLETED_EVIDENCE_PENDING' | 'PROVIDER_COMPLETED_EVIDENCE_FAILED'
  | 'COMPLETED' | 'LEGACY_UNVERIFIED';
export type ContractActivationStatus = 'NOT_ELIGIBLE' | 'ELIGIBLE' | 'REQUESTED' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'RECONCILIATION_REQUIRED';
export type ContractReviewStatus = 'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type ContractVersionReviewStatus = 'DRAFT' | 'INTERNAL_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export interface ContractVersionSnapshot {
  id: string;
  contractId: string;
  versionNumber: number;
  reviewStatus: ContractVersionReviewStatus;
  title: string;
  plan: string;
  quoteId?: string;
  annualValue: number;
  currency: 'VND';
  effectiveDate: string;
  customerName: string;
  customerContactName: string;
  customerEmail: string;
  createdByUserId: string;
  approvedTemplateVersionId?: string;
  approvedTemplateSnapshot?: {
    templateVersionId: string;
    templateVersionNumber: number;
    title: string;
    locale: 'vi' | 'en' | 'vi-en';
    contentDigest: string;
    sections: Array<{ heading: string; body: string }>;
  };
  contentDigest?: string;
  canonicalDocument?: ContractCanonicalDocumentArtifact;
  reviewDocument?: ContractReviewDocumentArtifact;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractReviewDocumentArtifact {
  kind: 'REVIEW_COPY';
  storageReference: string;
  fileName: string;
  sha256: string;
  byteLength: number;
  encryption: 'AES-256-GCM';
  encryptionKeyVersion: string;
  rendererVersion: string;
  generatedAt: Date;
}

export interface ContractCanonicalDocumentArtifact {
  kind: 'CANONICAL_UNSIGNED';
  storageReference: string;
  fileName: string;
  sha256: string;
  byteLength: number;
  encryption: 'AES-256-GCM';
  encryptionKeyVersion: string;
  rendererVersion: string;
  generatedAt: Date;
}

export interface ContractFinalEvidenceArtifact {
  kind: 'SIGNED_PDF' | 'COMPLETION_CERTIFICATE' | 'AUDIT_TRAIL';
  storageReference: string;
  fileName: string;
  mimeType: 'application/pdf' | 'application/json' | 'text/plain';
  sha256: string;
  byteLength: number;
  encryption: 'AES-256-GCM';
  encryptionKeyVersion: string;
  archivedAt: Date;
}

/** Immutable manifest binding provider output to the exact approved unsigned version. */
export interface ContractFinalEvidenceManifest {
  contractVersionId: string;
  canonicalDocumentSha256: string;
  providerKey: string;
  providerEnvelopeReference: string;
  providerCompletionEventReference: string;
  providerCompletedAt: Date;
  archivedAt: Date;
  manifestSha256: string;
  signedPdf: ContractFinalEvidenceArtifact;
  supportingArtifacts: ContractFinalEvidenceArtifact[];
}

export interface ContractDemoSigningSession {
  providerEnvelopeReference: string;
  contractVersionId: string;
  customerUserId: string;
  canonicalDocumentSha256: string;
  status: 'SENT' | 'COMPLETED';
  startedAt: Date;
  expiresAt: Date;
  completedAt?: Date;
  completionEventReference?: string;
}

export interface ContractAggregateRecord {
  id: string;
  leadId: string;
  organizationId: string;
  contractNumber: string;
  currentVersionId: string;
  lifecycleStatus: ContractLifecycleStatus;
  reviewStatus: ContractReviewStatus;
  providerCompletionStatus: 'NOT_STARTED' | 'CONFIRMED';
  archiveStatus: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'FAILED';
  finalEvidence?: ContractFinalEvidenceManifest;
  demoSigningSession?: ContractDemoSigningSession;
  activationStatus: ContractActivationStatus;
  customerUserId?: string;
  createdByUserId: string;
  submittedByUserId?: string;
  reviewedByUserId?: string;
  reviewedAt?: Date;
  reviewReason?: string;
  customerDecision: 'NONE' | 'CHANGES_REQUESTED' | 'DECLINED';
  customerDecisionByUserId?: string;
  customerDecisionAt?: Date;
  customerDecisionReason?: string;
  createRequestId: string;
  createRequestFingerprint: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractWithCurrentVersion {
  contract: ContractAggregateRecord;
  version: ContractVersionSnapshot;
}

export interface CreateContractDraftInput {
  leadId: string;
  organizationId: string;
  createdByUserId: string;
  requestId: string;
  contractId: string;
  versionId: string;
  contractNumber: string;
  requestFingerprint: string;
  title: string;
  plan: string;
  quoteId?: string;
  annualValue: number;
  effectiveDate: string;
  customerName: string;
  customerContactName: string;
  customerEmail: string;
  customerUserId?: string;
  approvedTemplateVersionId?: string;
  approvedTemplateSnapshot?: ContractVersionSnapshot['approvedTemplateSnapshot'];
  now: Date;
}

export interface ReviseContractInput {
  contractId: string;
  leadId: string;
  organizationId: string;
  actorUserId: string;
  requestId: string;
  requestFingerprint: string;
  versionId: string;
  title: string;
  plan: string;
  quoteId?: string;
  annualValue: number;
  effectiveDate: string;
  customerName: string;
  customerContactName: string;
  customerEmail: string;
  customerUserId?: string;
  approvedTemplateVersionId?: string;
  approvedTemplateSnapshot?: ContractVersionSnapshot['approvedTemplateSnapshot'];
  now: Date;
}

export type ContractReviewAction = 'APPROVE' | 'RETURN' | 'REJECT';
export type CustomerContractDecision = 'REQUEST_CHANGES' | 'DECLINE';

export interface ContractAggregateRepository {
  createDraft(input: CreateContractDraftInput): Promise<{ result: ContractWithCurrentVersion; replayed: boolean }>;
  revise(input: ReviseContractInput): Promise<{ result: ContractWithCurrentVersion; replayed: boolean } | null>;
  listForLead(leadId: string, organizationId: string): Promise<ContractWithCurrentVersion[]>;
  findForLead(contractId: string, leadId: string, organizationId: string): Promise<ContractWithCurrentVersion | null>;
  findForGrantedCustomer(contractId: string, userId: string, email: string): Promise<ContractWithCurrentVersion | null>;
  listForGrantedCustomer(userId: string, email: string): Promise<ContractWithCurrentVersion[]>;
  hasActiveGrantForLeadCustomer(leadId: string, userId: string): Promise<boolean>;
  submitForReview(input: { contractId: string; leadId: string; organizationId: string; actorUserId: string; now: Date }): Promise<ContractWithCurrentVersion | null>;
  review(input: { contractId: string; leadId: string; organizationId: string; actorUserId: string; action: ContractReviewAction; reason?: string; now: Date }): Promise<ContractWithCurrentVersion | null>;
  respondByCustomer(input: {
    contractId: string;
    customerUserId: string;
    action: CustomerContractDecision;
    reason: string;
    now: Date;
  }): Promise<ContractWithCurrentVersion | null>;
  markCustomerViewed(input: {
    contractId: string;
    customerUserId: string;
    customerEmail: string;
    now: Date;
  }): Promise<{ result: ContractWithCurrentVersion; changed: boolean } | null>;
  attachVerifiedFinalEvidence(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    actorUserId: string;
    manifest: ContractFinalEvidenceManifest;
    now: Date;
  }): Promise<{ result: ContractWithCurrentVersion; replayed: boolean } | null>;
  startDemoSigning(input: {
    contractId: string;
    versionId: string;
    customerUserId: string;
    providerEnvelopeReference: string;
    now: Date;
    expiresAt: Date;
  }): Promise<ContractWithCurrentVersion | null>;
  completeDemoSigning(input: {
    contractId: string;
    versionId: string;
    customerUserId: string;
    providerEnvelopeReference: string;
    completionEventReference: string;
    now: Date;
  }): Promise<ContractWithCurrentVersion | null>;
  findActivationEligible(leadId: string): Promise<ContractWithCurrentVersion | null>;
  attachReviewDocument(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    actorUserId: string;
    artifact: ContractReviewDocumentArtifact;
    now: Date;
  }): Promise<boolean>;
  attachCanonicalDocument(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    actorUserId: string;
    artifact: ContractCanonicalDocumentArtifact;
    now: Date;
  }): Promise<boolean>;
}

export const CONTRACT_AGGREGATE_REPOSITORY = Symbol('CONTRACT_AGGREGATE_REPOSITORY');
