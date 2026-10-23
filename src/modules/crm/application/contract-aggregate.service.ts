import { Types } from 'mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EffectivePermissionsService } from '../../rbac/application/effective-permissions.service';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import {
  CONTRACT_AGGREGATE_REPOSITORY,
  ContractAggregateRepository,
  ContractCanonicalDocumentArtifact,
  CustomerContractDecision,
  ContractReviewDocumentArtifact,
  ContractReviewAction,
  ContractWithCurrentVersion,
} from '../domain/contract-aggregate.types';
import { ContractInvitationAccessService } from './contract-invitation-access.service';
import { CONTRACT_AGGREGATE_UNIT_OF_WORK, ContractAggregateUnitOfWork } from './contract-aggregate-unit-of-work.port';
import { randomUUID, createHash } from 'node:crypto';
import { ContractTemplateService } from './contract-template.service';
import { ContractReviewDocumentService } from './contract-review-document.service';
import { CONTRACT_SIGNING_PROVIDER, ContractSigningProviderPort, VerifiedSigningProviderEvent } from '../domain/contract-signing-provider.port';
import { ContractNotificationEmailOutboxRepository } from '../domain/contract-notification-email-outbox.types';
import { calculateFinalEvidenceManifestSha256 } from '../domain/contract-final-evidence';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ContractAggregateService {
  constructor(
    private readonly access: ContractInvitationAccessService,
    private readonly permissions: EffectivePermissionsService,
    @Inject(CONTRACT_AGGREGATE_UNIT_OF_WORK) private readonly unitOfWork: ContractAggregateUnitOfWork,
    @Inject(CONTRACT_AGGREGATE_REPOSITORY) private readonly contractsRead: ContractAggregateRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly templates: ContractTemplateService,
    private readonly documentService: ContractReviewDocumentService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CONTRACT_SIGNING_PROVIDER) private readonly signingProvider: ContractSigningProviderPort,
    private readonly config: ConfigService,
  ) {}

  async createDraft(input: {
    leadId: string;
    organizationId?: string;
    requestId?: string;
    body: { title: string; plan: string; quoteId?: string; annualValue: number; effectiveDate?: string; approvedTemplateVersionId: string };
    actor: AuthenticatedUser;
  }) {
    if (!UUID_PATTERN.test(input.requestId ?? '')) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Provide a UUID Idempotency-Key.' });
    }
    const { lead, organizationId } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.manage',
    );
    const customerUserId = await this.assertCustomerAccountReady(lead);
    const approvedTemplate = await this.templates.requireApprovedVersion(input.body.approvedTemplateVersionId ?? '');
    const approvedTemplateVersionId = approvedTemplate.id;
    const approvedTemplateSnapshot = {
      templateVersionId: approvedTemplate.id,
      templateVersionNumber: approvedTemplate.versionNumber,
      title: approvedTemplate.title,
      locale: approvedTemplate.locale,
      contentDigest: approvedTemplate.contentDigest,
      sections: approvedTemplate.sections.map((section) => ({ heading: section.heading, body: section.body })),
    };
    if (lead.stage === 'LOST' || lead.stage === 'WON' || lead.status === 'CONVERTED') {
      throw new BadRequestException({ code: 'LEAD_NOT_CONTRACTABLE', message: 'A contract cannot be created for a lost or already converted lead.' });
    }
    const title = input.body?.title?.trim() ?? '';
    const plan = input.body?.plan?.trim() ?? '';
    const quoteId = input.body?.quoteId?.trim() || undefined;
    const annualValue = input.body?.annualValue;
    if (title.length < 3 || title.length > 200 || plan.length < 2 || plan.length > 100) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_DETAILS', message: 'Enter a valid contract title and plan.' });
    }
    if (!Number.isSafeInteger(annualValue) || annualValue < 1) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_VALUE', message: 'Contract value must be a positive whole VND amount.' });
    }
    const effectiveDate = input.body.effectiveDate || new Date().toISOString().slice(0, 10);
    const date = new Date(`${effectiveDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== effectiveDate) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_EFFECTIVE_DATE', message: 'Enter a valid effective date.' });
    }
    if (quoteId) this.assertAcceptedQuote(lead.quotes ?? [], quoteId, plan, annualValue);
    const customerName = (lead.company || '').trim();
    const customerContactName = (lead.contactName || '').trim();
    const customerEmail = (lead.contactEmail || '').trim().toLowerCase();
    if (!customerName || customerName.length > 200 || !customerContactName || customerContactName.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      throw new BadRequestException({ code: 'LEAD_CONTACT_DETAILS_REQUIRED', message: 'Complete the Lead company, contact name, and contact email before creating a contract draft.' });
    }

    const now = new Date();
    const contractId = randomUUID().replace(/-/g, '').slice(0, 24);
    const versionId = randomUUID().replace(/-/g, '').slice(0, 24);
    const prefix = customerName.replace(/[^a-z\d]/gi, '').slice(0, 4).toUpperCase().padEnd(4, 'X');
    const contractNumber = `CTR-${now.getUTCFullYear()}-${prefix}-${contractId.slice(-6).toUpperCase()}`;
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      actorUserId: input.actor.userId, leadId: lead.id, title, plan, quoteId, annualValue, effectiveDate, customerName, customerContactName, customerEmail, approvedTemplateVersionId,
    })).digest('hex');

    const result = await this.unitOfWork.run(async ({ contracts, audit }) => {
      const created = await contracts.createDraft({
        leadId: lead.id,
        organizationId,
        createdByUserId: input.actor.userId,
        requestId: input.requestId!,
        contractId,
        versionId,
        contractNumber,
        requestFingerprint,
        title,
        plan,
        quoteId,
        annualValue,
        effectiveDate,
        customerName,
        customerContactName,
        customerEmail,
        customerUserId,
        approvedTemplateVersionId,
        approvedTemplateSnapshot,
        now,
      });
      if (!created.replayed) {
        await audit.appendOnce(`contract-created:${created.result.contract.id}`, {
          actorUserId: input.actor.userId,
          organizationId,
          action: 'CONTRACT_DRAFT_CREATED',
          resourceType: 'CONTRACT',
          resourceId: created.result.contract.id,
          metadata: { leadId: lead.id, versionId: created.result.version.id, contractNumber: created.result.contract.contractNumber },
        });
      }
      return created;
    }, `contract:${contractId}`);
    return { ...this.present(result.result), replayed: result.replayed };
  }

  async listForSales(input: { leadId: string; organizationId?: string; actor: AuthenticatedUser }) {
    const { organizationId, lead } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.view',
    );
    const rows = await this.readRepository().listForLead(lead.id, organizationId);
    return rows.map((row) => this.present(row));
  }

  async revise(input: {
    leadId: string;
    contractId: string;
    organizationId?: string;
    requestId?: string;
    body: { title: string; plan: string; quoteId?: string; annualValue: number; effectiveDate?: string; approvedTemplateVersionId: string };
    actor: AuthenticatedUser;
  }) {
    if (!UUID_PATTERN.test(input.requestId ?? '')) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Provide a UUID Idempotency-Key.' });
    }
    if (!OBJECT_ID_PATTERN.test(input.contractId)) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_ID', message: 'Enter a valid contract identifier.' });
    }
    const { lead, organizationId } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.manage',
    );
    const customerUserId = await this.assertCustomerAccountReady(lead);
    const approvedTemplate = await this.templates.requireApprovedVersion(input.body.approvedTemplateVersionId ?? '');
    const approvedTemplateVersionId = approvedTemplate.id;
    const approvedTemplateSnapshot = {
      templateVersionId: approvedTemplate.id,
      templateVersionNumber: approvedTemplate.versionNumber,
      title: approvedTemplate.title,
      locale: approvedTemplate.locale,
      contentDigest: approvedTemplate.contentDigest,
      sections: approvedTemplate.sections.map((section) => ({ heading: section.heading, body: section.body })),
    };
    const title = input.body?.title?.trim() ?? '';
    const plan = input.body?.plan?.trim() ?? '';
    const quoteId = input.body?.quoteId?.trim() || undefined;
    const annualValue = input.body?.annualValue;
    if (title.length < 3 || title.length > 200 || plan.length < 2 || plan.length > 100 || !Number.isSafeInteger(annualValue) || annualValue < 1) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_DETAILS', message: 'Enter a valid contract title, plan, and whole VND value.' });
    }
    const effectiveDate = input.body.effectiveDate || new Date().toISOString().slice(0, 10);
    const date = new Date(`${effectiveDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== effectiveDate) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_EFFECTIVE_DATE', message: 'Enter a valid effective date.' });
    }
    if (quoteId) this.assertAcceptedQuote(lead.quotes ?? [], quoteId, plan, annualValue);
    const customerName = (lead.company || '').trim();
    const customerContactName = (lead.contactName || '').trim();
    const customerEmail = (lead.contactEmail || '').trim().toLowerCase();
    if (!customerName || !customerContactName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      throw new BadRequestException({ code: 'LEAD_CONTACT_DETAILS_REQUIRED', message: 'Complete the Lead company, contact name, and contact email before revising this contract.' });
    }
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      actorUserId: input.actor.userId, leadId: lead.id, contractId: input.contractId, title, plan, quoteId, annualValue, effectiveDate, customerName, customerContactName, customerEmail, approvedTemplateVersionId,
    })).digest('hex');
    const created = await this.unitOfWork.run(async ({ contracts, audit }) => {
      const result = await contracts.revise({
        contractId: input.contractId,
        leadId: lead.id,
        organizationId,
        actorUserId: input.actor.userId,
        requestId: input.requestId!,
        requestFingerprint,
        versionId: randomUUID().replace(/-/g, '').slice(0, 24),
        title,
        plan,
        quoteId,
        annualValue,
        effectiveDate,
        customerName,
        customerContactName,
        customerEmail,
        customerUserId,
        approvedTemplateVersionId,
        approvedTemplateSnapshot,
        now: new Date(),
      });
      if (!result) throw new ConflictException({ code: 'CONTRACT_REVISION_NOT_ALLOWED', message: 'Only a contract returned for changes can receive a new version.' });
      if (!result.replayed) {
        await audit.appendOnce(`contract-version-created:${result.result.contract.id}:${result.result.version.id}`, {
          actorUserId: input.actor.userId,
          organizationId,
          action: 'CONTRACT_VERSION_CREATED',
          resourceType: 'CONTRACT',
          resourceId: result.result.contract.id,
          metadata: { leadId: lead.id, versionId: result.result.version.id, versionNumber: String(result.result.version.versionNumber) },
        });
      }
      return result;
    }, `contract:${input.contractId}`);
    return { ...this.present(created.result), replayed: created.replayed };
  }

  async getForSales(input: { leadId: string; contractId: string; organizationId?: string; actor: AuthenticatedUser }) {
    const { organizationId, lead } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.view',
    );
    const result = await this.readRepository().findForLead(input.contractId, lead.id, organizationId);
    if (!result) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.present(result);
  }

  async submitForReview(input: { leadId: string; contractId: string; organizationId?: string; actor: AuthenticatedUser }) {
    const { organizationId, lead } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.manage',
    );
    await this.assertCustomerAccountReady(lead);
    const reviewerIds = await this.access.getContractReviewRecipients(lead, organizationId);
    const recipients = await this.getContractEmailRecipients(reviewerIds);
    const updated = await this.unitOfWork.run(async ({ contracts, audit, notifications, emailOutbox }) => {
      const updated = await contracts.submitForReview({
        contractId: input.contractId, leadId: lead.id, organizationId, actorUserId: input.actor.userId, now: new Date(),
      });
      if (!updated) throw new ConflictException({ code: 'CONTRACT_STATE_CONFLICT', message: 'Only a draft or returned contract can be submitted for review.' });
      await audit.appendOnce(`contract-review-submit:${updated.contract.id}:${updated.contract.revision}`, {
        actorUserId: input.actor.userId,
        organizationId,
        action: 'CONTRACT_SUBMITTED_FOR_REVIEW',
        resourceType: 'CONTRACT',
        resourceId: updated.contract.id,
        metadata: { leadId: lead.id, versionId: updated.version.id, revision: String(updated.contract.revision) },
      });
      await notifications.create({
        recipientUserIds: reviewerIds,
        type: 'CONTRACT_REVIEW_REQUESTED',
        title: 'Hợp đồng cần được duyệt',
        message: `${lead.company || 'Khách hàng'} có hợp đồng ${updated.contract.contractNumber} đang chờ bạn duyệt.`,
        eventKey: `contract-review-requested:${updated.contract.id}:${updated.contract.revision}`,
        resourceType: 'CONTRACT',
        resourceId: updated.contract.id,
        link: `/crm/leads/${lead.id}`,
      });
      await this.queueContractNoticeEmails(emailOutbox, {
        recipients,
        eventKey: `contract-review-requested:${updated.contract.id}:${updated.contract.revision}`,
        contractId: updated.contract.id,
        organizationId,
        actorUserId: input.actor.userId,
        title: 'Hợp đồng cần được duyệt',
        message: `Có hợp đồng ${updated.contract.contractNumber} đang chờ bạn duyệt trong ALSM.`,
        linkPath: `/crm/leads/${lead.id}`,
      });
      return updated;
    }, `contract:${input.contractId}`);
    const emailDelivery = this.queuedEmailSummary(recipients.length);
    return { ...this.present(updated), emailDelivery };
  }

  async review(input: { leadId: string; contractId: string; organizationId?: string; actor: AuthenticatedUser; action: ContractReviewAction; reason?: string }) {
    const { organizationId, lead } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.view',
    );
    if (!(await this.permissions.getEffectivePermissions(input.actor.userId)).includes('sales.contracts.review')) {
      throw new ForbiddenException({ code: 'CONTRACT_REVIEW_FORBIDDEN', message: 'You do not have permission to review contracts.' });
    }
    let queuedRecipients = 0;
    const updated = await this.unitOfWork.run(async ({ contracts, audit, notifications, emailOutbox }) => {
      const updated = await contracts.review({
        contractId: input.contractId,
        leadId: lead.id,
        organizationId,
        actorUserId: input.actor.userId,
        action: input.action,
        reason: input.reason,
        now: new Date(),
      });
      if (!updated) throw new ConflictException({ code: 'CONTRACT_REVIEW_CONFLICT', message: 'This contract cannot be reviewed by this user or is no longer awaiting review.' });
      await audit.appendOnce(`contract-review:${updated.contract.id}:${updated.contract.revision}`, {
        actorUserId: input.actor.userId,
        organizationId,
        action: `CONTRACT_REVIEW_${input.action}`,
        resourceType: 'CONTRACT',
        resourceId: updated.contract.id,
        metadata: { leadId: lead.id, versionId: updated.version.id, status: updated.contract.lifecycleStatus, reason: input.reason?.trim() ?? '' },
      });
      const outcome = input.action === 'APPROVE' ? 'đã được duyệt nội bộ' : input.action === 'RETURN' ? 'được yêu cầu chỉnh sửa' : 'bị từ chối';
      const signingNote = input.action === 'APPROVE' ? ' Hiện hệ thống chưa cấu hình nhà cung cấp ký nên chưa thể gửi ký online.' : '';
      const approvedForCustomer = input.action === 'APPROVE' && updated.contract.customerUserId;
      await notifications.create({
        recipientUserIds: approvedForCustomer
          ? [updated.contract.createdByUserId, updated.contract.customerUserId!]
          : [updated.contract.createdByUserId],
        type: `CONTRACT_REVIEW_${input.action}`,
        title: input.action === 'APPROVE' ? 'Hợp đồng sẵn sàng để xem' : input.action === 'RETURN' ? 'Hợp đồng cần chỉnh sửa' : 'Hợp đồng bị từ chối',
        message: approvedForCustomer
          ? `Hợp đồng ${updated.contract.contractNumber} đã được ALSM duyệt nội bộ. Bạn có thể đăng nhập ALSM để xem nội dung. Ký online hiện chưa được cấu hình.`
          : `Hợp đồng ${updated.contract.contractNumber} ${outcome}.${input.reason?.trim() ? ` Lý do: ${input.reason.trim()}` : ''}${signingNote}`,
        eventKey: `contract-review-result:${updated.contract.id}:${updated.contract.revision}`,
        resourceType: 'CONTRACT',
        resourceId: updated.contract.id,
        link: approvedForCustomer ? '/contracts' : `/crm/leads/${lead.id}`,
      });
      const intendedRecipientIds = input.action === 'APPROVE' && updated.contract.customerUserId
        ? [updated.contract.createdByUserId, updated.contract.customerUserId]
        : [updated.contract.createdByUserId];
      const recipients = await this.getContractEmailRecipients(intendedRecipientIds);
      queuedRecipients = await this.queueContractNoticeEmails(emailOutbox, {
        recipients,
        eventKey: `contract-review-result:${updated.contract.id}:${updated.contract.revision}`,
        contractId: updated.contract.id,
        organizationId,
        actorUserId: input.actor.userId,
        title: input.action === 'APPROVE' ? 'Hợp đồng đã được duyệt' : input.action === 'RETURN' ? 'Hợp đồng cần chỉnh sửa' : 'Hợp đồng bị từ chối',
        message: input.action === 'APPROVE'
          ? `Hợp đồng ${updated.contract.contractNumber} đã được ALSM duyệt nội bộ. Bạn có thể đăng nhập ALSM để xem bản hợp đồng.`
          : `Hợp đồng ${updated.contract.contractNumber} ${input.action === 'RETURN' ? 'được yêu cầu chỉnh sửa' : 'bị từ chối'} trong quy trình duyệt nội bộ. Đăng nhập ALSM để xem thông tin.`,
        linkPath: input.action === 'APPROVE' ? '/contracts' : `/crm/leads/${lead.id}`,
      });
      return updated;
    }, `contract:${input.contractId}`);
    const emailDelivery = this.queuedEmailSummary(queuedRecipients);
    return { ...this.present(updated), emailDelivery };
  }

  async getForCustomer(contractId: string, actor: AuthenticatedUser) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to view this contract.' });
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before viewing an invited contract.' });
    }
    const result = await this.readRepository().findForGrantedCustomer(contractId, actor.userId, user.email);
    if (!result) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.presentForCustomer(result);
  }

  async recordCustomerViewed(contractId: string, actor: AuthenticatedUser) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to open this contract.' });
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before opening an invited contract.' });
    }
    const viewed = await this.unitOfWork.run(async ({ contracts, audit, notifications }) => {
      const transition = await contracts.markCustomerViewed({
        contractId,
        customerUserId: actor.userId,
        customerEmail: user.email,
        now: new Date(),
      });
      if (!transition) return null;
      if (transition.changed) {
        const { contract, version } = transition.result;
        const eventKey = `contract-customer-viewed:${contract.id}:${version.id}`;
        await audit.appendOnce(eventKey, {
          actorUserId: actor.userId,
          organizationId: contract.organizationId,
          action: 'CONTRACT_CUSTOMER_VIEWED',
          resourceType: 'CONTRACT',
          resourceId: contract.id,
          metadata: { leadId: contract.leadId, versionId: version.id, contractNumber: contract.contractNumber },
        });
        await notifications.create({
          recipientUserIds: [contract.createdByUserId],
          type: 'CONTRACT_CUSTOMER_VIEWED',
          title: 'Khách hàng đã xem hợp đồng',
          message: `Khách hàng đã mở hợp đồng ${contract.contractNumber}. Đăng nhập ALSM để theo dõi phản hồi.`,
          eventKey,
          resourceType: 'CONTRACT',
          resourceId: contract.id,
          link: `/crm/leads/${contract.leadId}`,
        });
      }
      return transition.result;
    }, `contract-customer-view:${contractId}`);
    if (viewed) return this.presentForCustomer(viewed);
    // A concurrent first-view request may have won the state transition. Re-read through the
    // normal grant + invited-email ACL so a safe retry is idempotent rather than a false 404.
    const current = await this.readRepository().findForGrantedCustomer(contractId, actor.userId, user.email);
    if (!current) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.presentForCustomer(current);
  }

  async respondForCustomer(contractId: string, actor: AuthenticatedUser, action: CustomerContractDecision, reason: string) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to respond to this contract.' });
    const normalizedReason = typeof reason === 'string' ? reason.trim() : '';
    if (normalizedReason.length < 5 || normalizedReason.length > 1000) {
      throw new BadRequestException({ code: 'CONTRACT_CUSTOMER_REASON_INVALID', message: 'Provide a reason between 5 and 1000 characters.' });
    }
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before responding to an invited contract.' });
    }
    const current = await this.readRepository().findForGrantedCustomer(contractId, actor.userId, user.email);
    if (!current || current.contract.customerUserId !== actor.userId) {
      throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable to this account.' });
    }

    const ownerRecipients = await this.getContractEmailRecipients([current.contract.createdByUserId]);
    const updated = await this.unitOfWork.run(async ({ contracts, audit, notifications, emailOutbox }) => {
      const updated = await contracts.respondByCustomer({
        contractId,
        customerUserId: actor.userId,
        action,
        reason: normalizedReason,
        now: new Date(),
      });
      if (!updated) {
        throw new ConflictException({ code: 'CONTRACT_CUSTOMER_DECISION_CONFLICT', message: 'This contract is no longer open for a customer response. Refresh and review its current status.' });
      }
      const eventKey = `contract-customer-decision:${updated.contract.id}:${updated.version.id}:${updated.contract.revision}`;
      await audit.appendOnce(eventKey, {
        actorUserId: actor.userId,
        organizationId: updated.contract.organizationId,
        action: `CONTRACT_CUSTOMER_${action}`,
        resourceType: 'CONTRACT',
        resourceId: updated.contract.id,
        metadata: { versionId: updated.version.id, decision: action, reason: normalizedReason },
      });
      await notifications.create({
        recipientUserIds: [updated.contract.createdByUserId],
        type: `CONTRACT_CUSTOMER_${action}`,
        title: action === 'REQUEST_CHANGES' ? 'Khách hàng yêu cầu chỉnh sửa hợp đồng' : 'Khách hàng từ chối hợp đồng',
        message: action === 'REQUEST_CHANGES'
          ? `Khách hàng đã yêu cầu chỉnh sửa hợp đồng ${updated.contract.contractNumber}. Mở hồ sơ Lead để xem lý do và tạo phiên bản mới.`
          : `Khách hàng đã từ chối hợp đồng ${updated.contract.contractNumber}. Mở hồ sơ Lead để xem lý do.`,
        eventKey,
        resourceType: 'CONTRACT',
        resourceId: updated.contract.id,
        link: `/crm/leads/${updated.contract.leadId}`,
      });
      await this.queueContractNoticeEmails(emailOutbox, {
        recipients: ownerRecipients,
        eventKey,
        contractId: updated.contract.id,
        organizationId: updated.contract.organizationId,
        actorUserId: actor.userId,
        title: action === 'REQUEST_CHANGES' ? 'Khách hàng yêu cầu chỉnh sửa hợp đồng' : 'Khách hàng từ chối hợp đồng',
        message: action === 'REQUEST_CHANGES'
          ? `Khách hàng đã yêu cầu chỉnh sửa hợp đồng ${updated.contract.contractNumber}. Đăng nhập ALSM để xem lý do.`
          : `Khách hàng đã từ chối hợp đồng ${updated.contract.contractNumber}. Đăng nhập ALSM để xem lý do.`,
        linkPath: `/crm/leads/${updated.contract.leadId}`,
      });
      return updated;
    }, `contract:${contractId}`);
    const emailDelivery = this.queuedEmailSummary(ownerRecipients.length);
    return { ...this.presentForCustomer(updated), emailDelivery };
  }

  async listForOrganization(organizationId: string) {
    if (!OBJECT_ID_PATTERN.test(organizationId)) return [];
    try {
      const contractDocs = await (this.contractsRead as any).contracts
        .find({ organizationId: new Types.ObjectId(organizationId) })
        .sort({ createdAt: -1 })
        .exec();
      return contractDocs.map((c: any) => ({
        id: c._id.toString(),
        contractNumber: c.contractNumber,
        title: c.title || 'Enterprise Modernization Master Services Agreement (MSA)',
        organizationId: c.organizationId.toString(),
        organizationName: c.organizationName || 'Enterprise Organization',
        serviceMode: c.serviceMode || 'HYBRID',
        status: c.lifecycleStatus === 'COMPLETED' ? 'ACTIVE' : c.lifecycleStatus,
        lifecycleStatus: c.lifecycleStatus,
        activationStatus: c.activationStatus,
        plan: c.plan || 'Enterprise Core Modernization',
        effectiveDate: c.effectiveDate || '2026-02-15',
        endDate: c.endDate || '2027-02-14',
        scope: c.scope || {
          screensQuota: 1000,
          programsQuota: 500,
          storageGb: 50,
          targetTechnology: 'React 19 + TypeScript + Spring Boot 3 Java',
          supportTier: 'Dedicated Enterprise SLA (2h response)',
        },
        totalValue: c.totalValue || 75000,
        currency: c.currency || 'USD',
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
    } catch {
      return [];
    }
  }

  async listForCustomer(actor: AuthenticatedUser) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to view your contracts.' });
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before viewing invited contracts.' });
    }
    const contracts = await this.readRepository().listForGrantedCustomer(actor.userId, user.email);
    return contracts.map(({ contract, version }) => {
      this.assertVersionContentIntegrity(version);
      return {
        contract: {
          id: contract.id,
          contractNumber: contract.contractNumber,
          lifecycleStatus: contract.lifecycleStatus,
          reviewStatus: contract.reviewStatus,
        },
        version: {
          id: version.id,
          versionNumber: version.versionNumber,
          title: version.title,
          plan: version.plan,
          annualValue: version.annualValue,
          currency: version.currency,
          effectiveDate: version.effectiveDate,
        },
        documentAvailable: false,
        canonicalPdfAvailable: this.isApprovedForCustomer(contract),
        reviewPdfAvailable: this.isApprovedForCustomer(contract),
        signedPdfAvailable: this.hasVerifiedSignedPdf({ contract, version }),
        signingAvailable: false,
        signingBlockedReason: 'Online signing is unavailable until the signing provider, signer identity method, envelope workflow, and final evidence archive are configured and verified.',
        signingReadiness: this.getSigningReadiness({ contract, version }),
      };
    });
  }

  async getReviewPdfForSales(input: { leadId: string; contractId: string; organizationId?: string; actor: AuthenticatedUser }) {
    const { organizationId, lead } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.view',
    );
    const result = await this.readRepository().findForLead(input.contractId, lead.id, organizationId);
    if (!result) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.loadOrCreateReviewPdf(result, input.actor);
  }

  async getReviewPdfForCustomer(contractId: string, actor: AuthenticatedUser) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to view this contract.' });
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before downloading an invited contract.' });
    }
    const result = await this.readRepository().findForGrantedCustomer(contractId, actor.userId, user.email);
    if (!result) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.loadOrCreateReviewPdf(result, actor);
  }

  async getCanonicalPdfForSales(input: { leadId: string; contractId: string; organizationId?: string; actor: AuthenticatedUser }) {
    const { organizationId, lead } = await this.access.requireLeadAccess(
      input.actor.userId, input.organizationId, input.leadId, 'sales.leads.view',
    );
    const reload = () => this.readRepository().findForLead(input.contractId, lead.id, organizationId);
    const result = await reload();
    if (!result) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.loadOrCreateCanonicalPdf(result, input.actor, reload);
  }

  async getCanonicalPdfForCustomer(contractId: string, actor: AuthenticatedUser) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to view this contract.' });
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before downloading an invited contract.' });
    }
    const reload = () => this.readRepository().findForGrantedCustomer(contractId, actor.userId, user.email);
    const result = await reload();
    if (!result) throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable.' });
    return this.loadOrCreateCanonicalPdf(result, actor, reload);
  }

  async getFinalSignedPdfForCustomer(contractId: string, actor: AuthenticatedUser) {
    if (!OBJECT_ID_PATTERN.test(actor?.userId ?? '')) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sign in to download this contract.' });
    const user = await this.users.findById(actor.userId);
    if (!user?.isActive || !user.isEmailVerified) {
      throw new ForbiddenException({ code: 'VERIFIED_ACCOUNT_REQUIRED', message: 'Verify your email before downloading an invited contract.' });
    }
    const value = await this.readRepository().findForGrantedCustomer(contractId, actor.userId, user.email);
    if (!value || !this.hasVerifiedSignedPdf(value)) {
      throw new NotFoundException({ code: 'SIGNED_CONTRACT_EVIDENCE_NOT_FOUND', message: 'A verified signed contract PDF is unavailable to this account.' });
    }
    const artifact = value.contract.finalEvidence!.signedPdf;
    const storedFile = (await this.storage.readFiles(artifact.storageReference))
      .find((file) => file.relativePath === 'signed-pdf.pdf.aesgcm');
    if (!storedFile) {
      throw new ServiceUnavailableException({ code: 'SIGNED_CONTRACT_EVIDENCE_UNAVAILABLE', message: 'The archived signed PDF is temporarily unavailable.' });
    }
    const bytes = this.documentService.decryptEncryptedArtifact(
      storedFile.content,
      artifact.encryptionKeyVersion,
      artifact.sha256,
    );
    if (bytes.byteLength !== artifact.byteLength || !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new ServiceUnavailableException({ code: 'SIGNED_CONTRACT_EVIDENCE_INTEGRITY_FAILURE', message: 'The archived signed PDF failed its integrity check.' });
    }
    await this.unitOfWork.run(({ audit }) => audit.appendOnce(
      `contract-signed-pdf-downloaded:${value.contract.id}:${actor.userId}:${randomUUID()}`,
      {
        actorUserId: actor.userId,
        organizationId: value.contract.organizationId,
        action: 'CONTRACT_SIGNED_PDF_DOWNLOADED',
        resourceType: 'CONTRACT',
        resourceId: value.contract.id,
        metadata: { versionId: value.version.id, sha256: artifact.sha256, byteLength: String(artifact.byteLength) },
      },
    ), `contract-signed-pdf-download:${value.contract.id}`);
    const fileName = artifact.fileName.replace(/[^a-z\d._-]/gi, '_').slice(0, 180) || `contract-${value.contract.contractNumber}-signed.pdf`;
    return { bytes, fileName, sha256: artifact.sha256 };
  }

  /**
   * Finalize an already archived provider completion. This method is intentionally not exposed
   * through an HTTP controller; only a future provider webhook/reconciliation worker may call it
   * after verifying the event and storing provider-returned artifacts.
   */
  async finalizeVerifiedProviderCompletion(input: {
    contractId: string;
    leadId: string;
    organizationId: string;
    versionId: string;
    event: VerifiedSigningProviderEvent;
    manifest: NonNullable<ContractWithCurrentVersion['contract']['finalEvidence']>;
  }) {
    const readiness = this.signingProvider.getReadiness();
    if (
      !readiness.configured
      || !readiness.providerKey
      || !readiness.capabilities.verifyWebhook
      || !readiness.capabilities.downloadSignedArtifacts
      || input.event.eventType !== 'ENVELOPE_COMPLETED'
      || !input.event.providerEventReference
      || !input.event.providerEnvelopeReference
      || !(input.event.occurredAt instanceof Date)
      || !Number.isFinite(input.event.occurredAt.getTime())
      || !/^[a-f\d]{64}$/i.test(input.event.payloadSha256)
      || input.manifest.providerKey !== readiness.providerKey
      || input.manifest.providerCompletionEventReference !== input.event.providerEventReference
      || input.manifest.providerEnvelopeReference !== input.event.providerEnvelopeReference
      || !(input.manifest.providerCompletedAt instanceof Date)
      || input.manifest.providerCompletedAt.getTime() !== input.event.occurredAt.getTime()
    ) {
      throw new ConflictException({ code: 'PROVIDER_COMPLETION_NOT_VERIFIED', message: 'The provider completion event could not be verified for this contract.' });
    }

    const current = await this.readRepository().findForLead(input.contractId, input.leadId, input.organizationId);
    if (!current || current.version.id !== input.versionId || current.contract.customerUserId === undefined) {
      throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract is unavailable for finalization.' });
    }
    const intendedRecipientIds = [current.contract.createdByUserId, current.contract.customerUserId];
    const emailRecipients = await this.getContractEmailRecipients(intendedRecipientIds);
    const eventKey = `contract-provider-completed:${current.contract.id}:${current.version.id}:${input.event.providerEventReference}`;
    const result = await this.unitOfWork.run(async ({ contracts, audit, notifications, emailOutbox }) => {
      const archived = await contracts.attachVerifiedFinalEvidence({
        contractId: current.contract.id,
        leadId: current.contract.leadId,
        organizationId: current.contract.organizationId,
        versionId: current.version.id,
        actorUserId: current.contract.createdByUserId,
        manifest: input.manifest,
        now: new Date(),
      });
      if (!archived) {
        throw new ConflictException({ code: 'CONTRACT_EVIDENCE_ARCHIVE_CONFLICT', message: 'The contract is not ready to accept final provider evidence.' });
      }
      const completed = archived.result;
      await audit.appendOnce(eventKey, {
        actorUserId: completed.contract.createdByUserId,
        organizationId: completed.contract.organizationId,
        action: 'CONTRACT_PROVIDER_COMPLETION_ARCHIVED',
        resourceType: 'CONTRACT',
        resourceId: completed.contract.id,
        metadata: {
          leadId: completed.contract.leadId,
          versionId: completed.version.id,
          providerKey: input.manifest.providerKey,
          providerEventReference: input.event.providerEventReference,
          providerEventType: input.event.eventType,
          providerEventOccurredAt: input.event.occurredAt.toISOString(),
          providerPayloadSha256: input.event.payloadSha256,
          manifestSha256: input.manifest.manifestSha256,
          signedPdfSha256: input.manifest.signedPdf.sha256,
          replayed: String(archived.replayed),
        },
      });
      await notifications.create({
        recipientUserIds: [completed.contract.customerUserId!],
        type: 'CONTRACT_SIGNED_AND_ARCHIVED',
        title: 'Hợp đồng đã ký hoàn tất',
        message: `Hợp đồng ${completed.contract.contractNumber} đã được nhà cung cấp xác nhận và lưu hồ sơ. Đăng nhập ALSM để tải bản PDF đã ký.`,
        eventKey: `${eventKey}:customer`,
        resourceType: 'CONTRACT',
        resourceId: completed.contract.id,
        link: '/contracts',
      });
      await notifications.create({
        recipientUserIds: [completed.contract.createdByUserId],
        type: 'CONTRACT_SIGNED_AND_ARCHIVED',
        title: 'Hợp đồng đã ký hoàn tất',
        message: `Hợp đồng ${completed.contract.contractNumber} đã được nhà cung cấp xác nhận và lưu hồ sơ.`,
        eventKey: `${eventKey}:sales`,
        resourceType: 'CONTRACT',
        resourceId: completed.contract.id,
        link: `/crm/leads/${completed.contract.leadId}`,
      });
      await this.queueContractNoticeEmails(emailOutbox, {
        recipients: emailRecipients,
        eventKey,
        contractId: completed.contract.id,
        organizationId: completed.contract.organizationId,
        actorUserId: completed.contract.createdByUserId,
        title: 'Hợp đồng đã ký hoàn tất',
        message: `Hợp đồng ${completed.contract.contractNumber} đã được nhà cung cấp ký xác nhận và lưu PDF cùng hồ sơ bằng chứng trong ALSM.`,
        linkPath: '/contracts',
      });
      return completed;
    }, `contract-provider-completion:${current.contract.id}:${current.version.id}`);
    return { ...this.present(result), emailDelivery: this.queuedEmailSummary(emailRecipients.length) };
  }

  private async loadOrCreateReviewPdf(value: ContractWithCurrentVersion, actor: AuthenticatedUser) {
    if (!this.isApprovedForCustomer(value.contract)) {
      throw new ConflictException({ code: 'CONTRACT_REVIEW_PDF_NOT_READY', message: 'A review PDF is available only after internal approval.' });
    }
    this.assertVersionContentIntegrity(value.version);
    if (!value.version.approvedTemplateSnapshot) {
      throw new ConflictException({ code: 'CONTRACT_TEMPLATE_SNAPSHOT_REQUIRED', message: 'An approved immutable template snapshot is required.' });
    }

    let artifact = value.version.reviewDocument;
    if (!artifact) {
      const plainBytes = await this.documentService.renderReviewCopy(value);
      const encrypted = this.documentService.encryptReviewCopy(plainBytes, value.contract.contractNumber);
      const storageReference = await this.storage.writeFiles(
        `private/contracts/${value.contract.id}/${value.version.id}/review`,
        [{ relativePath: 'review-copy.pdf.aesgcm', content: encrypted.bytes }],
      );
      const createdAt = new Date();
      const proposed: ContractReviewDocumentArtifact = {
        kind: 'REVIEW_COPY',
        storageReference,
        fileName: encrypted.fileName,
        sha256: encrypted.sha256,
        byteLength: encrypted.byteLength,
        encryption: 'AES-256-GCM',
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        rendererVersion: encrypted.rendererVersion,
        generatedAt: createdAt,
      };
      const attached = await this.unitOfWork.run(async ({ contracts, audit }) => {
        const saved = await contracts.attachReviewDocument({
          contractId: value.contract.id,
          leadId: value.contract.leadId,
          organizationId: value.contract.organizationId,
          versionId: value.version.id,
          actorUserId: actor.userId,
          artifact: proposed,
          now: createdAt,
        });
        if (!saved) return false;
        await audit.appendOnce(`contract-review-pdf-created:${value.version.id}`, {
          actorUserId: actor.userId,
          organizationId: value.contract.organizationId,
          action: 'CONTRACT_REVIEW_PDF_CREATED',
          resourceType: 'CONTRACT_VERSION',
          resourceId: value.version.id,
          metadata: { contractId: value.contract.id, sha256: proposed.sha256, byteLength: String(proposed.byteLength), rendererVersion: proposed.rendererVersion },
        });
        return true;
      }, `contract-review-pdf:${value.version.id}`);
      artifact = attached ? proposed : undefined;
      if (!artifact) {
        const current = await this.readRepository().findForLead(value.contract.id, value.contract.leadId, value.contract.organizationId);
        artifact = current?.version.reviewDocument;
        if (!artifact || !current || !this.isApprovedForCustomer(current.contract)) {
          throw new ConflictException({ code: 'CONTRACT_REVIEW_PDF_STATE_CHANGED', message: 'The contract changed while the review PDF was being created. Refresh and retry.' });
        }
      }
    }

    const encryptedFile = (await this.storage.readFiles(artifact.storageReference))
      .find((file) => file.relativePath === 'review-copy.pdf.aesgcm');
    if (!encryptedFile) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_REVIEW_PDF_UNAVAILABLE', message: 'The private review PDF is unavailable.' });
    }
    const bytes = this.documentService.decryptReviewCopy(encryptedFile.content, artifact.encryptionKeyVersion, artifact.sha256);
    if (bytes.byteLength !== artifact.byteLength) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_REVIEW_FILE_INTEGRITY_FAILURE', message: 'The stored contract review file failed its integrity check.' });
    }
    const artifactToAudit = artifact;
    await this.unitOfWork.run(async ({ audit }) => {
      await audit.appendOnce(`contract-review-pdf-downloaded:${value.version.id}:${randomUUID()}`, {
        actorUserId: actor.userId,
        organizationId: value.contract.organizationId,
        action: 'CONTRACT_REVIEW_PDF_DOWNLOADED',
        resourceType: 'CONTRACT_VERSION',
        resourceId: value.version.id,
        metadata: { contractId: value.contract.id, sha256: artifactToAudit.sha256, byteLength: String(artifactToAudit.byteLength) },
      });
    }, `contract-review-pdf-download:${value.version.id}`);
    return { bytes, fileName: artifact.fileName, sha256: artifact.sha256 };
  }

  private async loadOrCreateCanonicalPdf(
    value: ContractWithCurrentVersion,
    actor: AuthenticatedUser,
    reload: () => Promise<ContractWithCurrentVersion | null>,
  ) {
    if (!this.isApprovedForCustomer(value.contract)) {
      throw new ConflictException({ code: 'CONTRACT_CANONICAL_PDF_NOT_READY', message: 'The contract PDF is available only after internal approval.' });
    }
    this.assertVersionContentIntegrity(value.version);
    if (!value.version.approvedTemplateSnapshot) {
      throw new ConflictException({ code: 'CONTRACT_TEMPLATE_SNAPSHOT_REQUIRED', message: 'An approved immutable template snapshot is required.' });
    }

    let artifact = value.version.canonicalDocument;
    if (!artifact) {
      const plainBytes = await this.documentService.renderCanonicalUnsigned(value);
      const encrypted = this.documentService.encryptCanonicalUnsigned(plainBytes, value.contract.contractNumber);
      const storageReference = await this.storage.writeFiles(
        `private/contracts/${value.contract.id}/${value.version.id}/canonical`,
        [{ relativePath: 'unsigned-contract.pdf.aesgcm', content: encrypted.bytes }],
      );
      const createdAt = new Date();
      const proposed: ContractCanonicalDocumentArtifact = {
        kind: 'CANONICAL_UNSIGNED',
        storageReference,
        fileName: encrypted.fileName,
        sha256: encrypted.sha256,
        byteLength: encrypted.byteLength,
        encryption: 'AES-256-GCM',
        encryptionKeyVersion: encrypted.encryptionKeyVersion,
        rendererVersion: encrypted.rendererVersion,
        generatedAt: createdAt,
      };
      const attached = await this.unitOfWork.run(async ({ contracts, audit }) => {
        const saved = await contracts.attachCanonicalDocument({
          contractId: value.contract.id,
          leadId: value.contract.leadId,
          organizationId: value.contract.organizationId,
          versionId: value.version.id,
          actorUserId: actor.userId,
          artifact: proposed,
          now: createdAt,
        });
        if (!saved) return false;
        await audit.appendOnce(`contract-canonical-pdf-created:${value.version.id}`, {
          actorUserId: actor.userId,
          organizationId: value.contract.organizationId,
          action: 'CONTRACT_CANONICAL_PDF_CREATED',
          resourceType: 'CONTRACT_VERSION',
          resourceId: value.version.id,
          metadata: { contractId: value.contract.id, sha256: proposed.sha256, byteLength: String(proposed.byteLength), rendererVersion: proposed.rendererVersion },
        });
        return true;
      }, `contract-canonical-pdf:${value.version.id}`);
      artifact = attached ? proposed : undefined;
      if (!artifact) {
        const current = await reload();
        artifact = current?.version.canonicalDocument;
        if (!artifact || !current || !this.isApprovedForCustomer(current.contract)) {
          throw new ConflictException({ code: 'CONTRACT_CANONICAL_PDF_STATE_CHANGED', message: 'The contract changed while its PDF was being created. Refresh and retry.' });
        }
      }
    }

    const encryptedFile = (await this.storage.readFiles(artifact.storageReference))
      .find((file) => file.relativePath === 'unsigned-contract.pdf.aesgcm');
    if (!encryptedFile) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_CANONICAL_PDF_UNAVAILABLE', message: 'The private contract PDF is unavailable.' });
    }
    const bytes = this.documentService.decryptReviewCopy(encryptedFile.content, artifact.encryptionKeyVersion, artifact.sha256);
    if (bytes.byteLength !== artifact.byteLength) {
      throw new ServiceUnavailableException({ code: 'CONTRACT_CANONICAL_PDF_INTEGRITY_FAILURE', message: 'The stored contract PDF failed its integrity check.' });
    }
    await this.unitOfWork.run(async ({ audit }) => {
      await audit.appendOnce(`contract-canonical-pdf-downloaded:${value.version.id}:${randomUUID()}`, {
        actorUserId: actor.userId,
        organizationId: value.contract.organizationId,
        action: 'CONTRACT_CANONICAL_PDF_DOWNLOADED',
        resourceType: 'CONTRACT_VERSION',
        resourceId: value.version.id,
        metadata: { contractId: value.contract.id, sha256: artifact.sha256, byteLength: String(artifact.byteLength) },
      });
    }, `contract-canonical-pdf-download:${value.version.id}`);
    return { bytes, fileName: artifact.fileName, sha256: artifact.sha256 };
  }

  private readRepository() {
    return this.contractsRead;
  }

  private assertAcceptedQuote(quotes: Record<string, unknown>[], quoteId: string, plan: string, annualValue: number) {
    const quote = quotes.find((item) => String(item.id) === quoteId);
    if (!quote) throw new NotFoundException({ code: 'CONTRACT_QUOTE_NOT_FOUND', message: 'The selected quote was not found on this lead.' });
    if (quote.status !== 'ACCEPTED') throw new BadRequestException({ code: 'CONTRACT_QUOTE_NOT_ACCEPTED', message: 'Only an accepted quote can be added to a contract.' });
    const quotedPlan = String(quote.planName ?? quote.plan ?? '');
    const amount = Number(quote.amount);
    const discount = Number(quote.discountPercent ?? 0);
    const expected = Number(quote.finalPrice ?? Math.round(amount * (1 - discount / 100)));
    if (plan !== quotedPlan || annualValue !== expected) throw new BadRequestException({ code: 'CONTRACT_QUOTE_MISMATCH', message: 'Contract plan and value must match the accepted quote.' });
  }

  private async assertCustomerAccountReady(lead: { id: string; contactEmail?: string }): Promise<string> {
    const customerEmail = lead.contactEmail?.trim().toLowerCase() ?? '';
    const customer = customerEmail ? await this.users.findByEmail(customerEmail) : null;
    if (
      !customer?.isActive
      || !customer.isEmailVerified
      || !(await this.contractsRead.hasActiveGrantForLeadCustomer(lead.id, customer.id))
    ) {
      throw new ConflictException({
        code: 'CUSTOMER_ACCOUNT_NOT_READY',
        message: 'The Lead contact must create or sign in to a verified ALSM account and accept the Lead invitation before contract work can continue.',
      });
    }
    return customer.id;
  }

  private present(value: ContractWithCurrentVersion) {
    this.assertVersionContentIntegrity(value.version);
    const { createRequestId: _requestId, createRequestFingerprint: _fingerprint, finalEvidence: _finalEvidence, ...contract } = value.contract;
    const { canonicalDocument: _canonicalDocument, reviewDocument: _reviewDocument, ...publicVersion } = value.version;
    void _requestId;
    void _fingerprint;
    void _reviewDocument;
    void _canonicalDocument;
    void _finalEvidence;
    return {
      contract,
      version: publicVersion,
      documentAvailable: false,
      canonicalPdfAvailable: this.isApprovedForCustomer(value.contract),
      reviewPdfAvailable: this.isApprovedForCustomer(value.contract),
      signedPdfAvailable: this.hasVerifiedSignedPdf(value),
      signingAvailable: false,
      signingBlockedReason: 'Online signing is unavailable until the signing provider, signer identity method, envelope workflow, and final evidence archive are configured and verified.',
      signingReadiness: this.getSigningReadiness(value),
    };
  }

  private presentForCustomer(value: ContractWithCurrentVersion) {
    this.assertVersionContentIntegrity(value.version);
    const { canonicalDocument: _canonicalDocument, reviewDocument: _reviewDocument, ...version } = value.version;
    void _canonicalDocument;
    void _reviewDocument;
    return {
      contract: {
        id: value.contract.id,
        contractNumber: value.contract.contractNumber,
        lifecycleStatus: value.contract.lifecycleStatus,
        reviewStatus: value.contract.reviewStatus,
        customerDecision: value.contract.customerDecision,
        customerDecisionAt: value.contract.customerDecisionAt,
        customerDecisionReason: value.contract.customerDecisionReason,
      },
      version: {
        id: version.id,
        contractId: version.contractId,
        versionNumber: version.versionNumber,
        reviewStatus: version.reviewStatus,
        title: version.title,
        plan: version.plan,
        quoteId: version.quoteId,
        annualValue: version.annualValue,
        currency: version.currency,
        effectiveDate: version.effectiveDate,
        customerName: version.customerName,
        customerContactName: version.customerContactName,
        customerEmail: version.customerEmail,
        approvedTemplateVersionId: version.approvedTemplateVersionId,
        approvedTemplateSnapshot: version.approvedTemplateSnapshot,
        contentDigest: version.contentDigest,
        createdAt: version.createdAt,
        updatedAt: version.updatedAt,
      },
      documentAvailable: false,
      canonicalPdfAvailable: this.isApprovedForCustomer(value.contract),
      reviewPdfAvailable: this.isApprovedForCustomer(value.contract),
      signedPdfAvailable: this.hasVerifiedSignedPdf(value),
      signingAvailable: false,
      signingBlockedReason: 'Online signing is unavailable until the signing provider, signer identity method, envelope workflow, and final evidence archive are configured and verified.',
      signingReadiness: this.getSigningReadiness(value),
    };
  }

  private async getContractEmailRecipients(userIds: string[]) {
    const ids = [...new Set(userIds)];
    const users = await Promise.all(ids.map((userId) => this.users.findById(userId)));
    return users.flatMap((user) => user && user.isActive && !user.isLocked && user.isEmailVerified
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)
      ? [{ userId: user.id, email: user.email.trim().toLowerCase() }]
      : []);
  }

  private async queueContractNoticeEmails(
    outbox: ContractNotificationEmailOutboxRepository,
    input: {
    recipients: Array<{ userId: string; email: string }>;
    eventKey: string;
    contractId: string;
    organizationId: string;
    actorUserId: string;
    title: string;
    message: string;
    linkPath: string;
    },
  ): Promise<number> {
    if (input.recipients.length === 0) return 0;
    const url = this.getContractPortalUrl(input.linkPath);
    const now = new Date();
    for (const recipient of input.recipients) {
      await outbox.enqueue({
        eventKey: `${input.eventKey}:email:${recipient.userId}`,
        contractId: input.contractId,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        subject: `ALSM — ${input.title}`,
        text: `${input.message}${url ? `\n\nMở ALSM: ${url}` : '\n\nĐăng nhập vào ALSM để tiếp tục.'}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172b4d"><h2>${this.escapeEmailHtml(input.title)}</h2><p>${this.escapeEmailHtml(input.message)}</p>${url ? `<p><a href="${this.escapeEmailHtml(url)}" style="display:inline-block;padding:10px 16px;background:#0b57d0;color:#fff;text-decoration:none;border-radius:6px">Mở ALSM</a></p>` : '<p>Đăng nhập vào ALSM để tiếp tục.</p>'}<p style="font-size:12px;color:#6b778c">Email này chỉ thông báo có cập nhật; hãy đăng nhập ALSM để xem nội dung hợp đồng.</p></div>`,
        now,
      });
    }
    return input.recipients.length;
  }

  private queuedEmailSummary(recipientCount: number) {
    return {
      status: recipientCount > 0 ? 'QUEUED' as const : 'NO_VERIFIED_RECIPIENT' as const,
      recipientCount,
    };
  }

  private getContractPortalUrl(path: string): string | undefined {
    const configured = this.config.get<string>('CONTRACT_PORTAL_URL')?.trim()
      || this.config.get<string>('APP_BASE_URL')?.trim();
    if (!configured) return undefined;
    try {
      const base = new URL(configured);
      const isLocal = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
      if (base.protocol !== 'https:' && (this.config.get<string>('NODE_ENV') === 'production' || !isLocal)) return undefined;
      return new URL(path, base).toString();
    } catch {
      return undefined;
    }
  }

  private escapeEmailHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
  }

  private isApprovedForCustomer(contract: ContractWithCurrentVersion['contract']): boolean {
    return contract.reviewStatus === 'APPROVED'
      && ['READY_FOR_SIGNATURE', 'SENT_TO_CUSTOMER', 'CUSTOMER_VIEWED'].includes(contract.lifecycleStatus);
  }

  private hasVerifiedSignedPdf(value: ContractWithCurrentVersion): boolean {
    const { contract, version } = value;
    const evidence = contract.finalEvidence;
    return contract.lifecycleStatus === 'COMPLETED'
      && contract.providerCompletionStatus === 'CONFIRMED'
      && contract.archiveStatus === 'VERIFIED'
      && Boolean(evidence)
      && Boolean(evidence!.signedPdf)
      && evidence!.contractVersionId === version.id
      && evidence!.canonicalDocumentSha256 === version.canonicalDocument?.sha256
      && Boolean(evidence!.providerKey && evidence!.providerEnvelopeReference && evidence!.providerCompletionEventReference)
      && evidence!.providerCompletedAt instanceof Date
      && Number.isFinite(evidence!.providerCompletedAt.getTime())
      && evidence!.archivedAt instanceof Date
      && Number.isFinite(evidence!.archivedAt.getTime())
      && evidence!.signedPdf.archivedAt instanceof Date
      && Number.isFinite(evidence!.signedPdf.archivedAt.getTime())
      && Array.isArray(evidence!.supportingArtifacts)
      && evidence!.supportingArtifacts.every((artifact) => artifact.archivedAt instanceof Date && Number.isFinite(artifact.archivedAt.getTime()))
      && /^[a-f\d]{64}$/i.test(evidence!.manifestSha256)
      && evidence!.manifestSha256 === calculateFinalEvidenceManifestSha256({
        contractVersionId: evidence!.contractVersionId,
        canonicalDocumentSha256: evidence!.canonicalDocumentSha256,
        providerKey: evidence!.providerKey,
        providerEnvelopeReference: evidence!.providerEnvelopeReference,
        providerCompletionEventReference: evidence!.providerCompletionEventReference,
        providerCompletedAt: evidence!.providerCompletedAt,
        archivedAt: evidence!.archivedAt,
        signedPdf: evidence!.signedPdf,
        supportingArtifacts: evidence!.supportingArtifacts,
      })
      && evidence!.signedPdf.kind === 'SIGNED_PDF'
      && evidence!.signedPdf.mimeType === 'application/pdf'
      && evidence!.signedPdf.encryption === 'AES-256-GCM'
      && evidence!.signedPdf.encryptionKeyVersion === 'v1'
      && Boolean(evidence!.signedPdf.fileName)
      && /^[a-f\d]{64}$/i.test(evidence!.signedPdf.sha256)
      && evidence!.signedPdf.byteLength > 0
      && Boolean(evidence!.signedPdf.storageReference);
  }

  private getSigningReadiness(value: ContractWithCurrentVersion) {
    const { contract, version } = value;
    const approved = this.isApprovedForCustomer(contract);
    const hasCanonicalPdf = Boolean(
      version.canonicalDocument
      && version.canonicalDocument.kind === 'CANONICAL_UNSIGNED'
      && version.canonicalDocument.sha256
      && version.canonicalDocument.storageReference
      && version.canonicalDocument.byteLength > 0,
    );
    const hasApprovedTemplateSnapshot = Boolean(
      version.approvedTemplateVersionId
      && version.approvedTemplateSnapshot
      && version.approvedTemplateSnapshot.templateVersionId === version.approvedTemplateVersionId,
    );
    const provider = this.signingProvider.getReadiness();
    const providerSupportsRequiredFlow = provider.configured
      && provider.capabilities.createSigningEnvelope
      && provider.capabilities.verifyWebhook
      && provider.capabilities.queryEnvelope
      && provider.capabilities.downloadSignedArtifacts
      && provider.capabilities.cancelEnvelope;
    const checks = [
      { code: 'INTERNAL_APPROVAL', status: approved ? 'READY' as const : 'PENDING' as const },
      { code: 'APPROVED_TEMPLATE_VERSION', status: hasApprovedTemplateSnapshot ? 'READY' as const : 'BLOCKED' as const },
      { code: 'CANONICAL_PDF', status: hasCanonicalPdf ? 'READY' as const : 'BLOCKED' as const },
      // User accounts currently have no verified phone identity field. Email verification alone
      // is not treated as the signing provider's required signer authentication.
      { code: 'SIGNER_IDENTITY_VERIFICATION', status: 'BLOCKED' as const },
      { code: 'SIGNING_PROVIDER', status: providerSupportsRequiredFlow ? 'READY' as const : 'BLOCKED' as const },
      // A provider port exists, but there is no envelope orchestration/webhook reconciliation yet.
      { code: 'SIGNING_ORCHESTRATION', status: 'BLOCKED' as const },
      // Provider completion evidence has no approved immutable archive pipeline yet.
      { code: 'FINAL_EVIDENCE_ARCHIVE', status: 'BLOCKED' as const },
    ];
    const canStart = checks.every((check) => check.status === 'READY');
    return {
      status: canStart ? 'READY' as const : approved ? 'BLOCKED' as const : 'NOT_READY' as const,
      canStart,
      // Keep the boolean fail-closed even if an adapter later advertises capability until
      // the state-changing controller and callback reconciliation are implemented.
      providerKey: provider.providerKey,
      providerEnvironment: provider.environment,
      checks,
    };
  }

  private assertVersionContentIntegrity(version: ContractWithCurrentVersion['version']) {
    const snapshot = version.approvedTemplateSnapshot;
    if (snapshot) {
      const digest = createHash('sha256').update(JSON.stringify({
        title: snapshot.title,
        locale: snapshot.locale,
        sections: snapshot.sections,
      })).digest('hex');
      if (digest !== snapshot.contentDigest || snapshot.templateVersionId !== version.approvedTemplateVersionId) {
        throw new ServiceUnavailableException({ code: 'CONTRACT_CONTENT_INTEGRITY_FAILURE', message: 'The contract text failed its integrity check.' });
      }
    }
  }
}
