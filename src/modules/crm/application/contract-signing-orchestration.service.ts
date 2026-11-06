import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { STORAGE_PORT, type StoragePort } from '../../../shared/storage/storage.port';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';
import {
  CONTRACT_AGGREGATE_REPOSITORY,
  type ContractAggregateRepository,
} from '../domain/contract-aggregate.types';
import {
  CONTRACT_INVITATION_REPOSITORY,
  type ContractInvitationRepository,
} from '../domain/contract-invitation.types';
import {
  CONTRACT_SIGNING_PROVIDER,
  type ContractSigningProviderPort,
} from '../domain/contract-signing-provider.port';
import {
  CONTRACT_AGGREGATE_UNIT_OF_WORK,
  type ContractAggregateUnitOfWork,
} from './contract-aggregate-unit-of-work.port';
import { ContractInvitationAccessService } from './contract-invitation-access.service';
import { ContractReviewDocumentService } from './contract-review-document.service';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

@Injectable()
export class ContractSigningOrchestrationService {
  private readonly logger = new Logger(ContractSigningOrchestrationService.name);

  constructor(
    @Inject(CONTRACT_AGGREGATE_REPOSITORY)
    private readonly contractsRead: ContractAggregateRepository,
    @Inject(CONTRACT_AGGREGATE_UNIT_OF_WORK)
    private readonly unitOfWork: ContractAggregateUnitOfWork,
    @Inject(CONTRACT_SIGNING_PROVIDER)
    private readonly signingProvider: ContractSigningProviderPort,
    @Inject(CONTRACT_INVITATION_REPOSITORY)
    private readonly invitations: ContractInvitationRepository,
    @Inject(USER_REPOSITORY)
    private readonly users: UserRepository,
    @Inject(STORAGE_PORT)
    private readonly storage: StoragePort,
    private readonly access: ContractInvitationAccessService,
    private readonly documentService: ContractReviewDocumentService,
  ) {}

  /**
   * Initiates online signing envelope with the configured provider (e.g. VNPT).
   * Enforces all 7 signing gates, including verified signer phone and approved PDF.
   */
  async initiateSigning(input: {
    contractId: string;
    organizationId?: string;
    actor: AuthenticatedUser;
  }): Promise<{
    contractId: string;
    providerEnvelopeReference: string;
    status: string;
  }> {
    if (!OBJECT_ID_PATTERN.test(input.actor.userId)) {
      throw new ForbiddenException({ code: 'UNAUTHORIZED', message: 'Authentication required.' });
    }

    const readiness = this.signingProvider.getReadiness();
    if (!readiness.configured || readiness.providerKey === 'ALSM_DEMO') {
      throw new ServiceUnavailableException({
        code: 'REAL_SIGNING_NOT_CONFIGURED',
        message: 'No official signing provider is configured for online signing.',
      });
    }

    // 1. Load contract and current version
    const contract = await this.contractsRead.findByProviderEnvelopeReference(input.contractId)
      ?? (await this.contractsRead.listForGrantedCustomer(input.actor.userId, input.actor.email))
        .find((c) => c.contract.id === input.contractId);

    if (!contract) {
      throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract unavailable.' });
    }

    // 2. Validate internal approval gate
    if (contract.contract.reviewStatus !== 'APPROVED') {
      throw new ConflictException({
        code: 'CONTRACT_NOT_APPROVED',
        message: 'The contract must be approved internally before sending for signature.',
      });
    }

    // 3. Validate template snapshot integrity gate
    const { version } = contract;
    if (!version.approvedTemplateSnapshot || !version.canonicalDocument) {
      throw new ConflictException({
        code: 'CANONICAL_DOCUMENT_MISSING',
        message: 'Canonical contract document is missing or not rendered.',
      });
    }

    // 4. Validate customer identity & phone verification gate
    if (!contract.contract.customerUserId) {
      throw new ConflictException({
        code: 'CUSTOMER_NOT_LINKED',
        message: 'No customer account is linked to this contract.',
      });
    }

    const grant = await this.invitations.findGrantByUserId(contract.contract.customerUserId);
    if (!grant || grant.phoneVerificationStatus !== 'VERIFIED') {
      throw new ConflictException({
        code: 'SIGNER_PHONE_UNVERIFIED',
        message: 'The customer signer must verify their phone number before signing.',
      });
    }

    // 5. Read & decrypt canonical PDF bytes from private storage
    const encryptedFile = (await this.storage.readFiles(version.canonicalDocument.storageReference))
      .find((file) => file.relativePath === 'unsigned-contract.pdf.aesgcm');
    if (!encryptedFile) {
      throw new ServiceUnavailableException({
        code: 'CONTRACT_CANONICAL_PDF_UNAVAILABLE',
        message: 'The canonical contract PDF file is unavailable in storage.',
      });
    }
    const canonicalBytes = this.documentService.decryptReviewCopy(
      encryptedFile.content,
      version.canonicalDocument.encryptionKeyVersion,
      version.canonicalDocument.sha256,
    );

    // 6. Resolve customer and ALSM user info
    const customerUser = await this.users.findById(contract.contract.customerUserId);
    if (!customerUser || !customerUser.isActive) {
      throw new ConflictException({ code: 'SIGNER_ACCOUNT_INACTIVE', message: 'Signer account is inactive.' });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000); // 7-day signing window

    // 7. Create envelope on the signing provider
    const envelope = await this.signingProvider.createEnvelope({
      idempotencyKey: `signing:${contract.contract.id}:${version.id}:${now.getTime()}`,
      contractId: contract.contract.id,
      contractVersionId: version.id,
      contractNumber: contract.contract.contractNumber,
      canonicalPdf: canonicalBytes,
      canonicalPdfSha256: version.canonicalDocument.sha256,
      signers: [
        {
          signerId: `alsm-${contract.contract.createdByUserId}`,
          party: 'ALSM',
          fullName: 'Đại diện ALSM',
          email: input.actor.email,
          sequence: 1,
        },
        {
          signerId: `customer-${customerUser.id}`,
          party: 'CUSTOMER',
          fullName: version.customerContactName || customerUser.fullName,
          email: customerUser.email,
          phone: grant.verifiedPhone,
          sequence: 2,
        },
      ],
      expiresAt,
    });

    // 8. Atomically transition contract state
    const updated = await this.unitOfWork.run(async ({ contracts, audit, notifications }) => {
      const started = await contracts.startProviderSigning({
        contractId: contract.contract.id,
        versionId: version.id,
        providerKey: readiness.providerKey ?? 'VNPT_ECONTRACT',
        providerEnvelopeReference: envelope.providerEnvelopeReference,
        now,
        expiresAt,
      });

      if (!started) {
        throw new ConflictException({
          code: 'CONTRACT_STATE_CONFLICT',
          message: 'The contract status changed before signing could begin. Refresh and review.',
        });
      }

      const eventKey = `contract-signing-started:${contract.contract.id}:${version.id}`;
      await audit.appendOnce(eventKey, {
        actorUserId: input.actor.userId,
        organizationId: contract.contract.organizationId,
        action: 'CONTRACT_SIGNING_ENVELOPE_CREATED',
        resourceType: 'CONTRACT',
        resourceId: contract.contract.id,
        metadata: {
          providerKey: readiness.providerKey ?? 'VNPT_ECONTRACT',
          providerEnvelopeReference: envelope.providerEnvelopeReference,
          versionId: version.id,
          expiresAt: expiresAt.toISOString(),
        },
      });

      await notifications.create({
        recipientUserIds: [customerUser.id],
        type: 'CONTRACT_SIGNING_READY',
        title: 'Hợp đồng sẵn sàng để ký điện tử',
        message: `Hợp đồng ${contract.contract.contractNumber} đã được gửi ký trực tuyến qua ${readiness.providerKey}.`,
        eventKey,
        resourceType: 'CONTRACT',
        resourceId: contract.contract.id,
        link: '/contracts',
      });

      return started;
    }, `contract-signing:${contract.contract.id}`);

    this.logger.log(
      `Signing envelope ${envelope.providerEnvelopeReference} created for contract ${contract.contract.id}`,
    );

    return {
      contractId: contract.contract.id,
      providerEnvelopeReference: envelope.providerEnvelopeReference,
      status: updated.contract.lifecycleStatus,
    };
  }

  /**
   * Cancels an active signing envelope.
   */
  async cancelSigning(input: {
    contractId: string;
    reason: string;
    actor: AuthenticatedUser;
  }): Promise<void> {
    const contract = await this.contractsRead.findByProviderEnvelopeReference(input.contractId);
    if (!contract || !contract.contract.providerSigningSession) {
      throw new NotFoundException({ code: 'CONTRACT_NOT_FOUND', message: 'Contract unavailable.' });
    }

    const { providerEnvelopeReference } = contract.contract.providerSigningSession;
    await this.signingProvider.cancelEnvelope(providerEnvelopeReference, input.reason);

    await this.unitOfWork.run(async ({ contracts, audit }) => {
      await contracts.updateProviderSigningStatus({
        contractId: contract.contract.id,
        providerEnvelopeReference,
        status: 'CANCELLED',
        now: new Date(),
      });

      await audit.appendOnce(`contract-signing-cancelled:${contract.contract.id}:${Date.now()}`, {
        actorUserId: input.actor.userId,
        organizationId: contract.contract.organizationId,
        action: 'CONTRACT_SIGNING_CANCELLED',
        resourceType: 'CONTRACT',
        resourceId: contract.contract.id,
        metadata: { reason: input.reason },
      });
    }, `cancel-signing:${contract.contract.id}`);
  }
}
