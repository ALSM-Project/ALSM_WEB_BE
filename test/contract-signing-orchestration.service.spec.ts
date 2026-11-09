import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ContractSigningOrchestrationService } from '../src/modules/crm/application/contract-signing-orchestration.service';
import { ContractSigningWebhookService } from '../src/modules/crm/application/contract-signing-webhook.service';
import type { ContractAggregateRepository, ContractWithCurrentVersion } from '../src/modules/crm/domain/contract-aggregate.types';
import type { ContractInvitationRepository, ContractAccessGrantRecord } from '../src/modules/crm/domain/contract-invitation.types';
import type { ContractSigningProviderPort, SigningProviderEnvelopeResult } from '../src/modules/crm/domain/contract-signing-provider.port';
import type { ContractAggregateUnitOfWork } from '../src/modules/crm/application/contract-aggregate-unit-of-work.port';
import type { UserRepository, UserRecord } from '../src/modules/users/domain/user.repository';
import type { ContractInvitationAccessService } from '../src/modules/crm/application/contract-invitation-access.service';
import type { ContractReviewDocumentService } from '../src/modules/crm/application/contract-review-document.service';
import type { StoragePort } from '../src/shared/storage/storage.port';
import type { AuthenticatedUser } from '../src/shared/logging/request-id.middleware';

describe('Phase 3 — Contract Signing Orchestration & Webhook Services', () => {
  let orchestrationService: ContractSigningOrchestrationService;
  let webhookService: ContractSigningWebhookService;

  let contractsRepo: jest.Mocked<ContractAggregateRepository>;
  let unitOfWork: jest.Mocked<ContractAggregateUnitOfWork>;
  let provider: jest.Mocked<ContractSigningProviderPort>;
  let invitationsRepo: jest.Mocked<ContractInvitationRepository>;
  let usersRepo: jest.Mocked<UserRepository>;
  let accessService: jest.Mocked<ContractInvitationAccessService>;
  let docService: jest.Mocked<ContractReviewDocumentService>;
  let storage: jest.Mocked<StoragePort>;

  const actor: AuthenticatedUser = {
    userId: '64f8a1b2c3d4e5f6a7b8c9d0',
    email: 'sales@alsm.vn',
    isPlatformAdmin: false,
  };

  const sampleContract: ContractWithCurrentVersion = {
    contract: {
      id: 'contract-123',
      leadId: 'lead-123',
      organizationId: 'org-123',
      contractNumber: 'HD-2026-001',
      currentVersionId: 'version-123',
      lifecycleStatus: 'READY_FOR_SIGNATURE',
      reviewStatus: 'APPROVED',
      providerCompletionStatus: 'NOT_STARTED',
      archiveStatus: 'NOT_STARTED',
      activationStatus: 'NOT_ELIGIBLE',
      customerUserId: '64f8a1b2c3d4e5f6a7b8c9d1',
      createdByUserId: '64f8a1b2c3d4e5f6a7b8c9d0',
      customerDecision: 'NONE',
      createRequestId: 'req-1',
      createRequestFingerprint: 'fp-1',
      revision: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    version: {
      id: 'version-123',
      contractId: 'contract-123',
      versionNumber: 1,
      reviewStatus: 'APPROVED',
      title: 'Hợp đồng hiện đại hóa Core Banking',
      plan: 'ENTERPRISE',
      annualValue: 500_000_000,
      currency: 'VND',
      effectiveDate: '2026-12-01',
      customerName: 'Ngân hàng ABC',
      customerContactName: 'Nguyen Van B',
      customerEmail: 'customer@bank.vn',
      createdByUserId: '64f8a1b2c3d4e5f6a7b8c9d0',
      approvedTemplateVersionId: 'tmpl-ver-1',
      approvedTemplateSnapshot: {
        templateVersionId: 'tmpl-ver-1',
        templateVersionNumber: 1,
        title: 'Mẫu hợp đồng khung',
        locale: 'vi',
        contentDigest: 'digest-123',
        sections: [{ heading: 'Điều 1', body: 'Nội dung điều 1' }],
      },
      canonicalDocument: {
        kind: 'CANONICAL_UNSIGNED',
        storageReference: 'private/contracts/contract-123/version-123/canonical',
        fileName: 'contract-HD-2026-001-canonical.pdf',
        sha256: 'abc123canonicalhash',
        byteLength: 4096,
        encryption: 'AES-256-GCM',
        encryptionKeyVersion: 'v1',
        rendererVersion: '1.0',
        generatedAt: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };

  const sampleGrant: ContractAccessGrantRecord = {
    id: 'grant-123',
    leadId: 'lead-123',
    userId: '64f8a1b2c3d4e5f6a7b8c9d1',
    invitationId: 'invite-123',
    status: 'ACTIVE',
    phoneVerificationStatus: 'VERIFIED',
    signingEligibility: 'ELIGIBLE',
    verifiedPhone: '+84901234567',
    createdAt: new Date(),
  };

  const sampleCustomerUser: UserRecord = {
    id: '64f8a1b2c3d4e5f6a7b8c9d1',
    email: 'customer@bank.vn',
    fullName: 'Nguyen Van B',
    isActive: true,
    isEmailVerified: true,
    roles: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as UserRecord;

  beforeEach(() => {
    provider = {
      getReadiness: jest.fn().mockReturnValue({
        configured: true,
        providerKey: 'VNPT_ECONTRACT',
        environment: 'SANDBOX',
        capabilities: {
          createSigningEnvelope: true,
          verifyWebhook: true,
          queryEnvelope: true,
          downloadSignedArtifacts: true,
          cancelEnvelope: true,
          sequentialSigners: true,
        },
      }),
      createEnvelope: jest.fn().mockResolvedValue({
        providerEnvelopeReference: 'vnpt-env-999',
        providerContractId: 'vnpt-env-999',
        status: 'SENT',
      } as SigningProviderEnvelopeResult),
      verifyWebhook: jest.fn(),
      getEnvelopeStatus: jest.fn(),
      downloadArtifacts: jest.fn(),
      cancelEnvelope: jest.fn().mockResolvedValue(undefined),
    };

    contractsRepo = {
      findByProviderEnvelopeReference: jest.fn().mockResolvedValue(sampleContract),
      listForGrantedCustomer: jest.fn().mockResolvedValue([sampleContract]),
      startProviderSigning: jest.fn().mockResolvedValue({
        ...sampleContract,
        contract: { ...sampleContract.contract, lifecycleStatus: 'CUSTOMER_SIGNING_IN_PROGRESS' },
      }),
      updateProviderSigningStatus: jest.fn().mockResolvedValue({
        ...sampleContract,
        contract: { ...sampleContract.contract, lifecycleStatus: 'PROVIDER_COMPLETED_EVIDENCE_PENDING' },
      }),
    } as unknown as jest.Mocked<ContractAggregateRepository>;

    const mockAudit = { appendOnce: jest.fn().mockResolvedValue(true) };
    const mockNotifications = { create: jest.fn().mockResolvedValue(true) };

    unitOfWork = {
      run: jest.fn().mockImplementation((callback: (args: unknown) => unknown) =>
        callback({
          contracts: contractsRepo,
          audit: mockAudit,
          notifications: mockNotifications,
        }),
      ),
    } as unknown as jest.Mocked<ContractAggregateUnitOfWork>;

    invitationsRepo = {
      findGrantByUserId: jest.fn().mockResolvedValue(sampleGrant),
    } as unknown as jest.Mocked<ContractInvitationRepository>;

    usersRepo = {
      findById: jest.fn().mockResolvedValue(sampleCustomerUser),
    } as unknown as jest.Mocked<UserRepository>;

    accessService = {} as unknown as jest.Mocked<ContractInvitationAccessService>;

    docService = {
      decryptReviewCopy: jest.fn().mockReturnValue(Buffer.from('%PDF-1.4 canonical bytes')),
    } as unknown as jest.Mocked<ContractReviewDocumentService>;

    storage = {
      readFiles: jest.fn().mockResolvedValue([
        { relativePath: 'unsigned-contract.pdf.aesgcm', content: Buffer.from('encrypted-bytes') },
      ]),
    } as unknown as jest.Mocked<StoragePort>;

    orchestrationService = new ContractSigningOrchestrationService(
      contractsRepo,
      unitOfWork,
      provider,
      invitationsRepo,
      usersRepo,
      storage,
      accessService,
      docService,
    );

    webhookService = new ContractSigningWebhookService(
      provider,
      contractsRepo,
      unitOfWork,
    );
  });

  describe('ContractSigningOrchestrationService.initiateSigning', () => {
    it('successfully initiates online signing with provider and verifies all 7 gates', async () => {
      const result = await orchestrationService.initiateSigning({
        contractId: 'contract-123',
        actor,
      });

      expect(result.providerEnvelopeReference).toBe('vnpt-env-999');
      expect(result.status).toBe('CUSTOMER_SIGNING_IN_PROGRESS');
      expect(provider.createEnvelope).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-123',
          contractNumber: 'HD-2026-001',
          signers: expect.arrayContaining([
            expect.objectContaining({ party: 'ALSM', email: 'sales@alsm.vn' }),
            expect.objectContaining({ party: 'CUSTOMER', phone: '+84901234567' }),
          ]),
        }),
      );
    });

    it('blocks signing if provider is unconfigured or demo only', async () => {
      provider.getReadiness.mockReturnValueOnce({
        configured: true,
        providerKey: 'ALSM_DEMO',
        capabilities: {} as never,
      });

      await expect(
        orchestrationService.initiateSigning({ contractId: 'contract-123', actor }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('blocks signing if customer phone is unverified', async () => {
      invitationsRepo.findGrantByUserId.mockResolvedValueOnce({
        ...sampleGrant,
        phoneVerificationStatus: 'UNVERIFIED',
      });

      await expect(
        orchestrationService.initiateSigning({ contractId: 'contract-123', actor }),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks signing if contract is not approved', async () => {
      contractsRepo.findByProviderEnvelopeReference.mockResolvedValueOnce({
        ...sampleContract,
        contract: { ...sampleContract.contract, reviewStatus: 'PENDING' },
      });

      await expect(
        orchestrationService.initiateSigning({ contractId: 'contract-123', actor }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('ContractSigningWebhookService.handleCallback', () => {
    it('rejects unverified webhook callbacks', async () => {
      provider.verifyWebhook.mockResolvedValueOnce(null);

      const result = await webhookService.handleCallback({
        rawBody: Buffer.from('invalid'),
        headers: {},
      });

      expect(result.accepted).toBe(false);
    });

    it('processes ENVELOPE_COMPLETED event and updates contract to PROVIDER_COMPLETED_EVIDENCE_PENDING', async () => {
      provider.verifyWebhook.mockResolvedValueOnce({
        providerEventReference: 'evt-comp-1',
        providerEnvelopeReference: 'vnpt-env-999',
        eventType: 'ENVELOPE_COMPLETED',
        occurredAt: new Date(),
        payloadSha256: 'payloadhash123',
      });

      const result = await webhookService.handleCallback({
        rawBody: Buffer.from('valid'),
        headers: { 'x-app-cb-key': 'k', 'x-app-cb-secret': 's' },
      });

      expect(result.accepted).toBe(true);
      expect(result.eventType).toBe('ENVELOPE_COMPLETED');
      expect(contractsRepo.updateProviderSigningStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          contractId: 'contract-123',
          providerEnvelopeReference: 'vnpt-env-999',
          status: 'PROVIDER_COMPLETED_EVIDENCE_PENDING',
          providerCompletionStatus: 'CONFIRMED',
        }),
      );
    });

    it('processes SIGNER_DECLINED event and updates contract to REJECTED', async () => {
      provider.verifyWebhook.mockResolvedValueOnce({
        providerEventReference: 'evt-dec-1',
        providerEnvelopeReference: 'vnpt-env-999',
        eventType: 'SIGNER_DECLINED',
        occurredAt: new Date(),
        payloadSha256: 'payloadhash123',
      });

      const result = await webhookService.handleCallback({
        rawBody: Buffer.from('valid'),
        headers: {},
      });

      expect(result.accepted).toBe(true);
      expect(contractsRepo.updateProviderSigningStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'REJECTED',
        }),
      );
    });
  });
});
