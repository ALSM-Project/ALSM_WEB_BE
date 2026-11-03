import { ConflictException, Injectable, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { ContractAccessGrant } from './contract-invitation.schema';
import {
  ContractAggregate,
  ContractAggregateDocument,
  ContractVersion,
  ContractVersionDocument,
} from './contract-aggregate.schema';
import {
  ContractCanonicalDocumentArtifact,
  ContractAggregateRecord,
  ContractAggregateRepository,
  ContractReviewDocumentArtifact,
  ContractFinalEvidenceManifest,
  ContractWithCurrentVersion,
  CreateContractDraftInput,
} from '../domain/contract-aggregate.types';
import { calculateFinalEvidenceManifestSha256 } from '../domain/contract-final-evidence';

@Injectable()
export class MongoContractAggregateRepository implements ContractAggregateRepository, OnApplicationBootstrap {
  private session?: ClientSession;
  private transaction?: object;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ContractAggregate.name) private readonly contracts: Model<ContractAggregate>,
    @InjectModel(ContractVersion.name) private readonly versions: Model<ContractVersion>,
    @InjectModel(ContractAccessGrant.name) private readonly grants: Model<ContractAccessGrant>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([this.contracts.init(), this.versions.init()]);
    const [contractIndexes, versionIndexes] = await Promise.all([
      this.contracts.collection.indexes(),
      this.versions.collection.indexes(),
    ]);
    const required = [
      contractIndexes.some((index) => index.name === 'contract_create_idempotency' && index.unique === true),
      contractIndexes.some((index) => index.key.contractNumber === 1 && index.unique === true),
      versionIndexes.some((index) => index.name === 'contract_version_number_unique' && index.unique === true),
      versionIndexes.some((index) => index.name === 'contract_version_revision_idempotency' && index.unique === true),
    ];
    if (required.some((exists) => !exists)) {
      throw new ServiceUnavailableException({
        code: 'CONTRACT_INDEX_UNAVAILABLE',
        message: 'Required contract uniqueness indexes are unavailable; contract mutations cannot start safely.',
      });
    }
  }

  inTransaction(session: ClientSession, connection: Connection): MongoContractAggregateRepository {
    requireActiveTransaction(session);
    if (this.contracts.db !== connection || this.versions.db !== connection || this.grants.db !== connection) {
      throw new Error('Contract transaction connection mismatch');
    }
    const repository = new MongoContractAggregateRepository(connection, this.contracts, this.versions, this.grants);
    repository.session = session;
    repository.transaction = session.transaction;
    return repository;
  }

  async createDraft(input: CreateContractDraftInput) {
    this.assertTransaction();
    const query = {
      leadId: new Types.ObjectId(input.leadId),
      createdByUserId: new Types.ObjectId(input.createdByUserId),
      createRequestId: input.requestId,
    };
    const existing = await this.contracts.findOne(query).session(this.scope()).exec();
    if (existing) {
      const version = await this.versions.findById(existing.currentVersionId).session(this.scope()).exec();
      if (!version) throw new ConflictException({ code: 'CONTRACT_VERSION_MISSING', message: 'The current contract version is unavailable.' });
      if (existing.createRequestFingerprint !== input.requestFingerprint) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was already used for different contract details.' });
      }
      return { result: this.withVersion(existing, version), replayed: true };
    }

    const contractId = new Types.ObjectId(input.contractId);
    const versionId = new Types.ObjectId(input.versionId);
    const [version] = await this.versions.create([{
      _id: versionId,
      contractId,
      versionNumber: 1,
      reviewStatus: 'DRAFT',
      title: input.title,
      plan: input.plan,
      quoteId: input.quoteId,
      annualValue: input.annualValue,
      currency: 'VND',
      effectiveDate: input.effectiveDate,
      customerName: input.customerName,
      customerContactName: input.customerContactName,
      customerEmail: input.customerEmail,
      customerUserId: input.customerUserId ? new Types.ObjectId(input.customerUserId) : undefined,
      approvedTemplateVersionId: input.approvedTemplateVersionId,
      approvedTemplateSnapshot: input.approvedTemplateSnapshot,
      createdByUserId: new Types.ObjectId(input.createdByUserId),
    }], { session: this.scope() });
    const [contract] = await this.contracts.create([{
      _id: contractId,
      leadId: new Types.ObjectId(input.leadId),
      organizationId: new Types.ObjectId(input.organizationId),
      contractNumber: input.contractNumber,
      currentVersionId: versionId,
      lifecycleStatus: 'DRAFT',
      reviewStatus: 'NOT_SUBMITTED',
      providerCompletionStatus: 'NOT_STARTED',
      archiveStatus: 'NOT_STARTED',
      activationStatus: 'NOT_ELIGIBLE',
      createdByUserId: new Types.ObjectId(input.createdByUserId),
      createRequestId: input.requestId,
      createRequestFingerprint: input.requestFingerprint,
      revision: 1,
    }], { session: this.scope() });
    return { result: this.withVersion(contract, version), replayed: false };
  }

  async revise(input: import('../domain/contract-aggregate.types').ReviseContractInput) {
    this.assertTransaction();
    const contractId = new Types.ObjectId(input.contractId);
    const replay = await this.versions.findOne({
      contractId,
      createdByUserId: new Types.ObjectId(input.actorUserId),
      revisionRequestId: input.requestId,
    }).session(this.scope()).exec();
    if (replay) {
      if (replay.revisionRequestFingerprint !== input.requestFingerprint) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was already used for different version details.' });
      }
      const currentContract = await this.contracts.findOne({
        _id: contractId,
        leadId: input.leadId,
        organizationId: input.organizationId,
      }).session(this.scope()).exec();
      if (!currentContract) return null;
      const currentVersion = await this.versions.findById(currentContract.currentVersionId).session(this.scope()).exec();
      return currentVersion ? { result: this.withVersion(currentContract, currentVersion), replayed: true } : null;
    }

    const contract = await this.contracts.findOne({
      _id: contractId,
      leadId: input.leadId,
      organizationId: input.organizationId,
      lifecycleStatus: 'CHANGES_REQUESTED',
      reviewStatus: 'CHANGES_REQUESTED',
    }).session(this.scope()).exec();
    if (!contract) return null;
    const latest = await this.versions.findOne({ contractId }).sort({ versionNumber: -1 }).session(this.scope()).exec();
    if (!latest) return null;
    const newVersionId = new Types.ObjectId(input.versionId);
    const [version] = await this.versions.create([{
      _id: newVersionId,
      contractId,
      versionNumber: latest.versionNumber + 1,
      reviewStatus: 'DRAFT',
      title: input.title,
      plan: input.plan,
      quoteId: input.quoteId,
      annualValue: input.annualValue,
      currency: 'VND',
      effectiveDate: input.effectiveDate,
      customerName: input.customerName,
      customerContactName: input.customerContactName,
      customerEmail: input.customerEmail,
      customerUserId: input.customerUserId ? new Types.ObjectId(input.customerUserId) : undefined,
      approvedTemplateVersionId: input.approvedTemplateVersionId,
      approvedTemplateSnapshot: input.approvedTemplateSnapshot,
      createdByUserId: new Types.ObjectId(input.actorUserId),
      revisionRequestId: input.requestId,
      revisionRequestFingerprint: input.requestFingerprint,
    }], { session: this.scope() });
    const updated = await this.contracts.findOneAndUpdate(
      {
        _id: contractId,
        leadId: input.leadId,
        organizationId: input.organizationId,
        currentVersionId: contract.currentVersionId,
        lifecycleStatus: 'CHANGES_REQUESTED',
        reviewStatus: 'CHANGES_REQUESTED',
        revision: contract.revision,
      },
      {
        $set: {
          currentVersionId: newVersionId,
          lifecycleStatus: 'DRAFT',
          reviewStatus: 'NOT_SUBMITTED',
          customerDecision: 'NONE',
          ...(input.customerUserId ? { customerUserId: new Types.ObjectId(input.customerUserId) } : {}),
        },
        $unset: {
          submittedByUserId: 1,
          reviewedByUserId: 1,
          reviewedAt: 1,
          reviewReason: 1,
          customerDecisionByUserId: 1,
          customerDecisionAt: 1,
          customerDecisionReason: 1,
        },
        $inc: { revision: 1 },
      },
      { new: true, session: this.scope() },
    ).exec();
    if (!updated) throw new ConflictException({ code: 'CONTRACT_STATE_CONFLICT', message: 'This contract changed while the new version was being created.' });
    return { result: this.withVersion(updated, version), replayed: false };
  }

  async listForLead(leadId: string, organizationId: string): Promise<ContractWithCurrentVersion[]> {
    const rows = await this.contracts.find({ leadId, organizationId }).sort({ createdAt: -1 }).exec();
    const results: ContractWithCurrentVersion[] = [];
    for (const row of rows) {
      const version = await this.versions.findById(row.currentVersionId).exec();
      if (version) results.push(this.withVersion(row, version));
    }
    return results;
  }

  async findForLead(contractId: string, leadId: string, organizationId: string) {
    if (!Types.ObjectId.isValid(contractId)) return null;
    const row = await this.contracts.findOne({ _id: contractId, leadId, organizationId }).exec();
    return row ? this.loadCurrent(row) : null;
  }

  async findForGrantedCustomer(contractId: string, userId: string, email: string) {
    if (!Types.ObjectId.isValid(contractId) || !Types.ObjectId.isValid(userId)) return null;
    const grants = await this.grants.find({ userId, status: 'ACTIVE' }).select('leadId').exec();
    if (grants.length === 0) return null;
    const row = await this.contracts.findOne({
      _id: contractId,
      leadId: { $in: grants.map((grant) => grant.leadId) },
      lifecycleStatus: {
        $in: [
          'READY_FOR_SIGNATURE',
          'CHANGES_REQUESTED',
          'REJECTED',
          'SENT_TO_CUSTOMER',
          'CUSTOMER_VIEWED',
          'CUSTOMER_SIGNING_IN_PROGRESS',
          'CUSTOMER_PARTIALLY_SIGNED',
          'CUSTOMER_SIGNED',
          'PROVIDER_COMPLETED_EVIDENCE_PENDING',
          'PROVIDER_COMPLETED_EVIDENCE_FAILED',
          'COMPLETED',
        ],
      },
      reviewStatus: { $in: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] },
    }).exec();
    if (!row) return null;
    const current = await this.loadCurrent(row);
    return current
      && Boolean(current.version.approvedTemplateVersionId)
      && Boolean(current.version.approvedTemplateSnapshot)
      && current.version.customerEmail.trim().toLowerCase() === email.trim().toLowerCase()
      ? current
      : null;
  }

  async listForGrantedCustomer(userId: string, email: string) {
    if (!Types.ObjectId.isValid(userId)) return [];
    const grants = await this.grants.find({ userId, status: 'ACTIVE' }).select('leadId').exec();
    if (grants.length === 0) return [];
    const rows = await this.contracts.find({
      leadId: { $in: grants.map((grant) => grant.leadId) },
      lifecycleStatus: {
        $in: [
          'READY_FOR_SIGNATURE', 'CHANGES_REQUESTED', 'REJECTED', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED',
          'CUSTOMER_SIGNING_IN_PROGRESS', 'CUSTOMER_PARTIALLY_SIGNED', 'CUSTOMER_SIGNED',
          'PROVIDER_COMPLETED_EVIDENCE_PENDING', 'PROVIDER_COMPLETED_EVIDENCE_FAILED', 'COMPLETED',
        ],
      },
      reviewStatus: { $in: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] },
    }).sort({ updatedAt: -1 }).exec();
    const results: ContractWithCurrentVersion[] = [];
    for (const row of rows) {
      const current = await this.loadCurrent(row);
      if (
        current
        && current.version.customerEmail.trim().toLowerCase() === email.trim().toLowerCase()
        && current.version.approvedTemplateSnapshot
      ) results.push(current);
    }
    return results;
  }

  async hasActiveGrantForLeadCustomer(leadId: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(leadId) || !Types.ObjectId.isValid(userId)) return false;
    return Boolean(await this.grants.exists({ leadId, userId, status: 'ACTIVE' }).exec());
  }

  async submitForReview(input: { contractId: string; leadId: string; organizationId: string; actorUserId: string; now: Date }) {
    this.assertTransaction();
    const contract = await this.contracts.findOneAndUpdate(
      {
        _id: input.contractId,
        leadId: input.leadId,
        organizationId: input.organizationId,
        lifecycleStatus: { $in: ['DRAFT', 'CHANGES_REQUESTED'] },
        revision: { $gte: 1 },
      },
      {
        $set: { lifecycleStatus: 'INTERNAL_REVIEW', reviewStatus: 'PENDING', submittedByUserId: input.actorUserId },
        $inc: { revision: 1 },
      },
      { new: true, session: this.scope() },
    ).exec();
    if (!contract) return null;
    const versionUpdate = await this.versions.updateOne(
      { _id: contract.currentVersionId, contractId: contract._id, reviewStatus: { $in: ['DRAFT', 'CHANGES_REQUESTED'] } },
      { $set: { reviewStatus: 'INTERNAL_REVIEW', submittedAt: input.now } },
      { session: this.scope() },
    ).exec();
    if (versionUpdate.modifiedCount !== 1) throw new ConflictException({ code: 'CONTRACT_VERSION_STATE_CONFLICT', message: 'The contract version changed; refresh and retry.' });
    return this.loadCurrent(contract);
  }

  async review(input: { contractId: string; leadId: string; organizationId: string; actorUserId: string; action: 'APPROVE' | 'RETURN' | 'REJECT'; reason?: string; now: Date }) {
    this.assertTransaction();
    const existing = await this.contracts.findOne({
      _id: input.contractId,
      leadId: input.leadId,
      organizationId: input.organizationId,
      lifecycleStatus: 'INTERNAL_REVIEW',
      reviewStatus: 'PENDING',
    }).session(this.scope()).exec();
    if (!existing || String(existing.createdByUserId) === input.actorUserId) return null;
    const version = await this.versions.findOne({ _id: existing.currentVersionId, contractId: existing._id }).session(this.scope()).exec();
    if (!version) return null;
    if (input.action === 'APPROVE' && !version.approvedTemplateVersionId) {
      throw new ConflictException({
        code: 'APPROVED_LEGAL_TEMPLATE_REQUIRED',
        message: 'A Legal-approved contract template must be configured before this version can be approved for signature.',
      });
    }
    if (input.action !== 'APPROVE' && !input.reason?.trim()) {
      throw new ConflictException({ code: 'REVIEW_REASON_REQUIRED', message: 'Provide a reason when returning or rejecting a contract.' });
    }

    // Approval also queues the customer notification, so represent the actual next step.
    // Provider signing remains a separate, unavailable workflow until its adapter is configured.
    const lifecycleStatus = input.action === 'APPROVE' ? 'SENT_TO_CUSTOMER' : input.action === 'RETURN' ? 'CHANGES_REQUESTED' : 'REJECTED';
    const reviewStatus = input.action === 'APPROVE' ? 'APPROVED' : input.action === 'RETURN' ? 'CHANGES_REQUESTED' : 'REJECTED';
    const updated = await this.contracts.findOneAndUpdate(
      { _id: existing._id, lifecycleStatus: 'INTERNAL_REVIEW', reviewStatus: 'PENDING', revision: existing.revision },
      {
        $set: {
          lifecycleStatus,
          reviewStatus,
          reviewedByUserId: new Types.ObjectId(input.actorUserId),
          reviewedAt: input.now,
          reviewReason: input.reason?.trim(),
        },
        $inc: { revision: 1 },
      },
      { new: true, session: this.scope() },
    ).exec();
    if (!updated) return null;
    const versionUpdate = await this.versions.updateOne(
      { _id: version._id, contractId: existing._id, reviewStatus: 'INTERNAL_REVIEW' },
      {
        $set: {
          reviewStatus,
          ...(input.action === 'APPROVE' ? { approvedByUserId: new Types.ObjectId(input.actorUserId), approvedAt: input.now } : { returnedAt: input.now, returnReason: input.reason?.trim() }),
        },
      },
      { session: this.scope() },
    ).exec();
    if (versionUpdate.modifiedCount !== 1) throw new ConflictException({ code: 'CONTRACT_VERSION_STATE_CONFLICT', message: 'The contract version changed; refresh and retry.' });
    const reviewedVersion = await this.versions.findById(version._id).session(this.scope()).exec();
    if (!reviewedVersion) throw new ConflictException({ code: 'CONTRACT_VERSION_MISSING', message: 'The reviewed contract version is unavailable.' });
    return this.withVersion(updated, reviewedVersion);
  }

  async respondByCustomer(input: {
    contractId: string;
    customerUserId: string;
    action: 'REQUEST_CHANGES' | 'DECLINE';
    reason: string;
    now: Date;
  }): Promise<ContractWithCurrentVersion | null> {
    this.assertTransaction();
    const existing = await this.contracts.findOne({
      _id: input.contractId,
      customerUserId: input.customerUserId,
      currentVersionId: { $exists: true },
      lifecycleStatus: { $in: ['READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED'] },
      reviewStatus: 'APPROVED',
    }).session(this.scope()).exec();
    if (!existing) return null;
    const activeGrant = await this.grants.exists({
      leadId: existing.leadId,
      userId: input.customerUserId,
      status: 'ACTIVE',
    }).session(this.scope()).exec();
    if (!activeGrant) return null;
    const version = await this.versions.findOne({
      _id: existing.currentVersionId,
      contractId: existing._id,
      reviewStatus: 'APPROVED',
    }).session(this.scope()).exec();
    if (!version) return null;

    const isRequestingChanges = input.action === 'REQUEST_CHANGES';
    const lifecycleStatus = isRequestingChanges ? 'CHANGES_REQUESTED' : 'REJECTED';
    const reviewStatus = isRequestingChanges ? 'CHANGES_REQUESTED' : 'REJECTED';
    const customerDecision = isRequestingChanges ? 'CHANGES_REQUESTED' : 'DECLINED';
    const updated = await this.contracts.findOneAndUpdate(
      {
        _id: existing._id,
        customerUserId: input.customerUserId,
        currentVersionId: version._id,
        lifecycleStatus: existing.lifecycleStatus,
        reviewStatus: 'APPROVED',
        revision: existing.revision,
      },
      {
        $set: {
          lifecycleStatus,
          reviewStatus,
          customerDecision,
          customerDecisionByUserId: new Types.ObjectId(input.customerUserId),
          customerDecisionAt: input.now,
          customerDecisionReason: input.reason.trim(),
        },
        $inc: { revision: 1 },
      },
      { new: true, session: this.scope() },
    ).exec();
    if (!updated) return null;

    const versionUpdate = await this.versions.updateOne(
      { _id: version._id, contractId: existing._id, reviewStatus: 'APPROVED' },
      {
        $set: {
          reviewStatus,
          returnedAt: input.now,
          returnReason: input.reason.trim(),
        },
      },
      { session: this.scope() },
    ).exec();
    if (versionUpdate.modifiedCount !== 1) throw new ConflictException({ code: 'CONTRACT_VERSION_STATE_CONFLICT', message: 'The contract version changed; refresh and retry.' });
    const updatedVersion = await this.versions.findById(version._id).session(this.scope()).exec();
    if (!updatedVersion) throw new ConflictException({ code: 'CONTRACT_VERSION_MISSING', message: 'The contract version is unavailable.' });
    return this.withVersion(updated, updatedVersion);
  }

  async markCustomerViewed(input: { contractId: string; customerUserId: string; customerEmail: string; now: Date }) {
    this.assertTransaction();
    const existing = await this.contracts.findOne({
      _id: input.contractId,
      customerUserId: input.customerUserId,
      lifecycleStatus: {
        $in: [
          'READY_FOR_SIGNATURE', 'CHANGES_REQUESTED', 'REJECTED', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED',
          'CUSTOMER_SIGNING_IN_PROGRESS', 'CUSTOMER_PARTIALLY_SIGNED', 'CUSTOMER_SIGNED',
          'PROVIDER_COMPLETED_EVIDENCE_PENDING', 'PROVIDER_COMPLETED_EVIDENCE_FAILED', 'COMPLETED',
        ],
      },
      reviewStatus: { $in: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] },
    }).session(this.scope()).exec();
    if (!existing) return null;
    const activeGrant = await this.grants.exists({
      leadId: existing.leadId,
      userId: input.customerUserId,
      status: 'ACTIVE',
    }).session(this.scope());
    if (!activeGrant) return null;
    const current = await this.loadCurrent(existing);
    if (!current || current.version.customerEmail.trim().toLowerCase() !== input.customerEmail.trim().toLowerCase()) return null;

    if (
      existing.lifecycleStatus !== 'READY_FOR_SIGNATURE'
      && existing.lifecycleStatus !== 'SENT_TO_CUSTOMER'
    ) {
      return { result: current, changed: false };
    }
    if (existing.reviewStatus !== 'APPROVED') return { result: current, changed: false };

    const updated = await this.contracts.findOneAndUpdate(
      {
        _id: existing._id,
        customerUserId: input.customerUserId,
        lifecycleStatus: { $in: ['READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER'] },
        reviewStatus: 'APPROVED',
        revision: existing.revision,
      },
      {
        $set: { lifecycleStatus: 'CUSTOMER_VIEWED' },
        $inc: { revision: 1 },
      },
      { new: true, session: this.scope() },
    ).exec();
    if (!updated) return null;
    const result = await this.loadCurrent(updated);
    return result ? { result, changed: true } : null;
  }

  async attachVerifiedFinalEvidence(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    actorUserId: string;
    manifest: ContractFinalEvidenceManifest;
    now: Date;
  }): Promise<{ result: ContractWithCurrentVersion; replayed: boolean } | null> {
    this.assertTransaction();
    const manifest = input.manifest;
    const signedPdf = manifest.signedPdf;
    const datesAreValid = [manifest.providerCompletedAt, manifest.archivedAt, signedPdf.archivedAt]
      .every((date) => date instanceof Date && Number.isFinite(date.getTime()));
    const artifactsAreValid = [signedPdf, ...(manifest.supportingArtifacts ?? [])].every((artifact) =>
      artifact.storageReference.trim().length > 0
      && /^[a-f\d]{64}$/i.test(artifact.sha256)
      && Number.isSafeInteger(artifact.byteLength)
      && artifact.byteLength > 0
      && artifact.encryption === 'AES-256-GCM'
      && artifact.encryptionKeyVersion.trim().length > 0
      && artifact.fileName.trim().length > 0
      && artifact.archivedAt instanceof Date
      && Number.isFinite(artifact.archivedAt.getTime()),
    );
    if (
      !datesAreValid
      || !artifactsAreValid
      || signedPdf.kind !== 'SIGNED_PDF'
      || signedPdf.mimeType !== 'application/pdf'
      || manifest.providerKey.trim().length === 0
      || manifest.providerEnvelopeReference.trim().length === 0
      || manifest.providerCompletionEventReference.trim().length === 0
      || !/^[a-f\d]{64}$/i.test(manifest.canonicalDocumentSha256)
      || manifest.manifestSha256 !== calculateFinalEvidenceManifestSha256({
        contractVersionId: manifest.contractVersionId,
        canonicalDocumentSha256: manifest.canonicalDocumentSha256,
        providerKey: manifest.providerKey,
        providerEnvelopeReference: manifest.providerEnvelopeReference,
        providerCompletionEventReference: manifest.providerCompletionEventReference,
        providerCompletedAt: manifest.providerCompletedAt,
        archivedAt: manifest.archivedAt,
        signedPdf: manifest.signedPdf,
        supportingArtifacts: manifest.supportingArtifacts ?? [],
      })
    ) {
      throw new ConflictException({ code: 'FINAL_EVIDENCE_MANIFEST_INVALID', message: 'The final contract evidence manifest is invalid.' });
    }

    const contract = await this.contracts.findOne({
      _id: input.contractId,
      leadId: input.leadId,
      organizationId: input.organizationId,
      currentVersionId: input.versionId,
      reviewStatus: 'APPROVED',
      providerCompletionStatus: 'CONFIRMED',
      lifecycleStatus: { $in: ['PROVIDER_COMPLETED_EVIDENCE_PENDING', 'PROVIDER_COMPLETED_EVIDENCE_FAILED', 'COMPLETED'] },
      archiveStatus: { $in: ['PENDING', 'FAILED', 'VERIFIED'] },
    }).session(this.scope()).exec();
    if (!contract) return null;

    const version = await this.versions.findOne({
      _id: input.versionId,
      contractId: contract._id,
      reviewStatus: 'APPROVED',
      'canonicalDocument.kind': 'CANONICAL_UNSIGNED',
      'canonicalDocument.sha256': manifest.canonicalDocumentSha256,
    }).session(this.scope()).exec();
    if (!version || String(manifest.contractVersionId) !== String(version._id)) {
      throw new ConflictException({ code: 'FINAL_EVIDENCE_VERSION_MISMATCH', message: 'Final evidence does not match the current approved contract version.' });
    }

    if (contract.lifecycleStatus === 'COMPLETED' && contract.archiveStatus === 'VERIFIED') {
      if (contract.finalEvidence?.manifestSha256 !== manifest.manifestSha256) {
        throw new ConflictException({ code: 'FINAL_EVIDENCE_ALREADY_ARCHIVED', message: 'Different final evidence is already archived for this contract.' });
      }
      return { result: this.withVersion(contract, version), replayed: true };
    }

    const updated = await this.contracts.findOneAndUpdate({
      _id: contract._id,
      currentVersionId: version._id,
      revision: contract.revision,
      reviewStatus: 'APPROVED',
      providerCompletionStatus: 'CONFIRMED',
      lifecycleStatus: { $in: ['PROVIDER_COMPLETED_EVIDENCE_PENDING', 'PROVIDER_COMPLETED_EVIDENCE_FAILED'] },
      archiveStatus: { $in: ['PENDING', 'FAILED'] },
    }, {
      $set: {
        lifecycleStatus: 'COMPLETED',
        archiveStatus: 'VERIFIED',
        activationStatus: 'ELIGIBLE',
        finalEvidence: manifest,
        completedAt: input.now,
      },
      $inc: { revision: 1 },
    }, { new: true, session: this.scope() }).exec();
    if (!updated) throw new ConflictException({ code: 'FINAL_EVIDENCE_STATE_CONFLICT', message: 'The contract changed while final evidence was being archived.' });
    return { result: this.withVersion(updated, version), replayed: false };
  }

  async findActivationEligible(leadId: string) {
    const row = await this.contracts.findOne({
      leadId,
      lifecycleStatus: 'COMPLETED',
      providerCompletionStatus: 'CONFIRMED',
      archiveStatus: 'VERIFIED',
      activationStatus: 'ELIGIBLE',
      customerUserId: { $exists: true },
      'finalEvidence.contractVersionId': { $exists: true },
      'finalEvidence.manifestSha256': { $type: 'string' },
      'finalEvidence.signedPdf.kind': 'SIGNED_PDF',
      'finalEvidence.signedPdf.mimeType': 'application/pdf',
      'finalEvidence.signedPdf.sha256': { $type: 'string' },
      'finalEvidence.signedPdf.storageReference': { $type: 'string' },
    }).sort({ completedAt: -1 }).exec();
    if (!row) return null;
    const current = await this.loadCurrent(row);
    const evidence = row.finalEvidence;
    return current
      && evidence
      && String(evidence.contractVersionId) === current.version.id
      && current.version.canonicalDocument?.kind === 'CANONICAL_UNSIGNED'
      && evidence.canonicalDocumentSha256 === current.version.canonicalDocument.sha256
      ? current
      : null;
  }

  async attachReviewDocument(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    actorUserId: string;
    artifact: ContractReviewDocumentArtifact;
    now: Date;
  }): Promise<boolean> {
    this.assertTransaction();
    const contract = await this.contracts.findOne({
      _id: input.contractId,
      leadId: input.leadId,
      organizationId: input.organizationId,
      currentVersionId: input.versionId,
      lifecycleStatus: { $in: ['INTERNAL_REVIEW', 'READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED'] },
    }).session(this.scope()).exec();
    if (!contract) return false;
    const updated = await this.versions.updateOne(
      { _id: input.versionId, contractId: contract._id, reviewDocument: { $exists: false } },
      { $set: { reviewDocument: input.artifact, updatedAt: input.now } },
      { session: this.scope() },
    ).exec();
    return updated.modifiedCount === 1;
  }

  async attachCanonicalDocument(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    actorUserId: string;
    artifact: ContractCanonicalDocumentArtifact;
    now: Date;
  }): Promise<boolean> {
    this.assertTransaction();
    const contract = await this.contracts.findOne({
      _id: input.contractId,
      leadId: input.leadId,
      organizationId: input.organizationId,
      currentVersionId: input.versionId,
      lifecycleStatus: { $in: ['READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED'] },
      reviewStatus: 'APPROVED',
    }).session(this.scope()).exec();
    if (!contract) return false;
    const updated = await this.versions.updateOne(
      { _id: input.versionId, contractId: contract._id, reviewStatus: 'APPROVED', canonicalDocument: { $exists: false } },
      { $set: { canonicalDocument: input.artifact, updatedAt: input.now } },
      { session: this.scope() },
    ).exec();
    return updated.modifiedCount === 1;
  }

  private async loadCurrent(contract: ContractAggregateDocument): Promise<ContractWithCurrentVersion | null> {
    const version = await this.versions.findOne({ _id: contract.currentVersionId, contractId: contract._id }).exec();
    return version ? this.withVersion(contract, version) : null;
  }

  private withVersion(contract: ContractAggregateDocument, version: ContractVersionDocument): ContractWithCurrentVersion {
    return { contract: this.mapContract(contract), version: {
      id: version.id,
      contractId: String(version.contractId),
      versionNumber: version.versionNumber,
      reviewStatus: version.reviewStatus,
      title: version.title,
      plan: version.plan,
      quoteId: version.quoteId,
      annualValue: version.annualValue,
      currency: 'VND',
      effectiveDate: version.effectiveDate,
      customerName: version.customerName,
      customerContactName: version.customerContactName,
      customerEmail: version.customerEmail,
      createdByUserId: String(version.createdByUserId),
      approvedTemplateVersionId: version.approvedTemplateVersionId,
      approvedTemplateSnapshot: version.approvedTemplateSnapshot ? {
        templateVersionId: version.approvedTemplateSnapshot.templateVersionId,
        templateVersionNumber: version.approvedTemplateSnapshot.templateVersionNumber,
        title: version.approvedTemplateSnapshot.title,
        locale: version.approvedTemplateSnapshot.locale,
        contentDigest: version.approvedTemplateSnapshot.contentDigest,
        sections: version.approvedTemplateSnapshot.sections.map((section) => ({ heading: section.heading, body: section.body })),
      } : undefined,
      contentDigest: version.contentDigest,
      canonicalDocument: version.canonicalDocument ? {
        kind: version.canonicalDocument.kind,
        storageReference: version.canonicalDocument.storageReference,
        fileName: version.canonicalDocument.fileName,
        sha256: version.canonicalDocument.sha256,
        byteLength: version.canonicalDocument.byteLength,
        encryption: version.canonicalDocument.encryption,
        encryptionKeyVersion: version.canonicalDocument.encryptionKeyVersion,
        rendererVersion: version.canonicalDocument.rendererVersion,
        generatedAt: version.canonicalDocument.generatedAt,
      } : undefined,
      reviewDocument: version.reviewDocument ? {
        kind: version.reviewDocument.kind,
        storageReference: version.reviewDocument.storageReference,
        fileName: version.reviewDocument.fileName,
        sha256: version.reviewDocument.sha256,
        byteLength: version.reviewDocument.byteLength,
        encryption: version.reviewDocument.encryption,
        encryptionKeyVersion: version.reviewDocument.encryptionKeyVersion,
        rendererVersion: version.reviewDocument.rendererVersion,
        generatedAt: version.reviewDocument.generatedAt,
      } : undefined,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
    } };
  }

  private mapContract(doc: ContractAggregateDocument): ContractAggregateRecord {
    return {
      id: doc.id,
      leadId: String(doc.leadId),
      organizationId: String(doc.organizationId),
      contractNumber: doc.contractNumber,
      currentVersionId: String(doc.currentVersionId),
      lifecycleStatus: doc.lifecycleStatus,
      reviewStatus: doc.reviewStatus,
      providerCompletionStatus: doc.providerCompletionStatus,
      archiveStatus: doc.archiveStatus,
      finalEvidence: doc.finalEvidence ? {
        contractVersionId: String(doc.finalEvidence.contractVersionId),
        canonicalDocumentSha256: doc.finalEvidence.canonicalDocumentSha256,
        providerKey: doc.finalEvidence.providerKey,
        providerEnvelopeReference: doc.finalEvidence.providerEnvelopeReference,
        providerCompletionEventReference: doc.finalEvidence.providerCompletionEventReference,
        providerCompletedAt: doc.finalEvidence.providerCompletedAt,
        archivedAt: doc.finalEvidence.archivedAt,
        manifestSha256: doc.finalEvidence.manifestSha256,
        signedPdf: this.mapFinalEvidenceArtifact(doc.finalEvidence.signedPdf),
        supportingArtifacts: (doc.finalEvidence.supportingArtifacts ?? []).map((artifact) => this.mapFinalEvidenceArtifact(artifact)),
      } : undefined,
      activationStatus: doc.activationStatus,
      customerUserId: doc.customerUserId ? String(doc.customerUserId) : undefined,
      createdByUserId: String(doc.createdByUserId),
      submittedByUserId: doc.submittedByUserId ? String(doc.submittedByUserId) : undefined,
      reviewedByUserId: doc.reviewedByUserId ? String(doc.reviewedByUserId) : undefined,
      reviewedAt: doc.reviewedAt,
      reviewReason: doc.reviewReason,
      customerDecision: doc.customerDecision ?? 'NONE',
      customerDecisionByUserId: doc.customerDecisionByUserId ? String(doc.customerDecisionByUserId) : undefined,
      customerDecisionAt: doc.customerDecisionAt,
      customerDecisionReason: doc.customerDecisionReason,
      createRequestId: doc.createRequestId,
      createRequestFingerprint: doc.createRequestFingerprint,
      revision: doc.revision,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private mapFinalEvidenceArtifact(artifact: NonNullable<ContractAggregateDocument['finalEvidence']>['signedPdf']) {
    return {
      kind: artifact.kind,
      storageReference: artifact.storageReference,
      fileName: artifact.fileName,
      mimeType: artifact.mimeType,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      encryption: artifact.encryption,
      encryptionKeyVersion: artifact.encryptionKeyVersion,
      archivedAt: artifact.archivedAt,
    };
  }

  private scope(): ClientSession {
    this.assertTransaction();
    return this.session!;
  }

  private assertTransaction(): void {
    if (!this.session) throw new Error('Contract aggregate writes require an audited transaction');
    requireActiveTransaction(this.session);
    if (this.transaction !== this.session.transaction) throw new Error('Stale contract transaction participant');
  }
}
