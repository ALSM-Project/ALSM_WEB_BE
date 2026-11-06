import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractEvidencePipelineService } from '../src/modules/crm/infrastructure/contract-evidence-pipeline.service';
import { ContractSigningProviderPort } from '../src/modules/crm/domain/contract-signing-provider.port';
import {
  ContractAggregateRepository,
  type ContractWithCurrentVersion,
} from '../src/modules/crm/domain/contract-aggregate.types';
import { ContractAggregateUnitOfWork } from '../src/modules/crm/application/contract-aggregate-unit-of-work.port';
import { ContractAggregateService } from '../src/modules/crm/application/contract-aggregate.service';
import { ContractReviewDocumentService } from '../src/modules/crm/application/contract-review-document.service';
import { StoragePort } from '../src/shared/storage/storage.port';

describe('ContractEvidencePipelineService (Phase 4)', () => {
  let service: ContractEvidencePipelineService;
  let mockProvider: jest.Mocked<ContractSigningProviderPort>;
  let mockContractsRead: jest.Mocked<ContractAggregateRepository>;
  let mockUnitOfWork: jest.Mocked<ContractAggregateUnitOfWork>;
  let mockAggregateService: jest.Mocked<ContractAggregateService>;
  let mockDocumentService: jest.Mocked<ContractReviewDocumentService>;
  let mockStorage: jest.Mocked<StoragePort>;
  let mockConfig: jest.Mocked<ConfigService>;

  const CONTRACT_ID = 'contract-123';
  const ENVELOPE_REF = 'vnpt-env-999';

  // Helper to create a structurally valid signed PDF
  const createValidSignedPdf = () => {
    const part1BeforeByteRange = '%PDF-1.7\n1 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (Signer 1) ';
    const gap = '<< /Contents <308201...00> >>\nendobj\n';
    const part2 = '%%EOF\n';

    const placeholder = '/ByteRange [ 0000000000 0000000000 0000000000 0000000000 ]\n';
    const totalPart1Len = Buffer.byteLength(part1BeforeByteRange) + Buffer.byteLength(placeholder);
    const gapLen = Buffer.byteLength(gap);
    const part2Len = Buffer.byteLength(part2);

    const actualRange = `/ByteRange [ ${String(0).padStart(10, '0')} ${String(totalPart1Len).padStart(10, '0')} ${String(totalPart1Len + gapLen).padStart(10, '0')} ${String(part2Len).padStart(10, '0')} ]\n`;
    const part1 = Buffer.from(part1BeforeByteRange + actualRange);
    return Buffer.concat([part1, Buffer.from(gap), Buffer.from(part2)]);
  };

  beforeEach(() => {
    mockProvider = {
      getReadiness: jest.fn().mockReturnValue({
        configured: true,
        providerKey: 'VNPT_ECONTRACT',
        capabilities: {
          createEnvelope: true,
          verifyWebhook: true,
          queryEnvelope: true,
          downloadSignedArtifacts: true,
          cancelEnvelope: true,
        },
      }),
      createEnvelope: jest.fn(),
      verifyWebhook: jest.fn(),
      getEnvelopeStatus: jest.fn(),
      downloadArtifacts: jest.fn(),
      cancelEnvelope: jest.fn(),
    };

    mockContractsRead = {
      findByProviderEnvelopeReference: jest.fn(),
      findForLead: jest.fn(),
      findForGrantedCustomer: jest.fn(),
      findActivationEligible: jest.fn(),
    } as unknown as jest.Mocked<ContractAggregateRepository>;

    mockUnitOfWork = {
      run: jest.fn().mockImplementation(async (work) => {
        const contracts = {
          updateProviderSigningStatus: jest.fn().mockResolvedValue(true),
        };
        const audit = {
          appendOnce: jest.fn().mockResolvedValue(undefined),
        };
        return work({ contracts, audit });
      }),
    };

    mockAggregateService = {
      finalizeVerifiedProviderCompletion: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<ContractAggregateService>;

    mockDocumentService = {
      encryptEvidenceArtifact: jest.fn().mockImplementation((bytes: Buffer, fileName: string) => ({
        bytes: Buffer.from(`encrypted-${bytes.toString()}`),
        sha256: 'a'.repeat(64),
        byteLength: bytes.length,
        encryptionKeyVersion: 'v1',
        fileName,
      })),
    } as unknown as jest.Mocked<ContractReviewDocumentService>;

    mockStorage = {
      writeFiles: jest.fn().mockResolvedValue('storage-ref-456'),
      resolvePath: jest.fn(),
      readFiles: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CONTRACT_SIGNING_MODE') return 'VNPT';
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new ContractEvidencePipelineService(
      mockProvider,
      mockContractsRead,
      mockUnitOfWork,
      mockAggregateService,
      mockDocumentService,
      mockStorage,
      mockConfig,
    );
  });

  it('throws NotFoundException if contract is not found for envelope ref', async () => {
    mockContractsRead.findByProviderEnvelopeReference.mockResolvedValue(null);

    await expect(
      service.processEvidenceDownload({
        contractId: CONTRACT_ID,
        providerEnvelopeReference: ENVELOPE_REF,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns replayed result if contract is already COMPLETED and VERIFIED', async () => {
    mockContractsRead.findByProviderEnvelopeReference.mockResolvedValue({
      contract: {
        id: CONTRACT_ID,
        contractNumber: 'CTR-2026-TEST-0001',
        leadId: 'lead-1',
        organizationId: 'org-1',
        lifecycleStatus: 'COMPLETED',
        archiveStatus: 'VERIFIED',
        finalEvidence: {
          manifestSha256: 'm'.repeat(64),
          signedPdf: { sha256: 's'.repeat(64) },
        },
      },
      version: { id: 'ver-1' },
    } as unknown as ContractWithCurrentVersion);

    const result = await service.processEvidenceDownload({
      contractId: CONTRACT_ID,
      providerEnvelopeReference: ENVELOPE_REF,
    });

    expect(result.replayed).toBe(true);
    expect(result.success).toBe(true);
    expect(mockProvider.downloadArtifacts).not.toHaveBeenCalled();
  });

  it('fails if provider returns no signed PDF', async () => {
    mockContractsRead.findByProviderEnvelopeReference.mockResolvedValue({
      contract: {
        id: CONTRACT_ID,
        contractNumber: 'CTR-2026-TEST-0001',
        leadId: 'lead-1',
        organizationId: 'org-1',
        lifecycleStatus: 'PROVIDER_COMPLETED_EVIDENCE_PENDING',
      },
      version: { id: 'ver-1' },
    } as unknown as ContractWithCurrentVersion);

    mockProvider.downloadArtifacts.mockResolvedValue([
      {
        kind: 'AUDIT_TRAIL',
        fileName: 'audit.json',
        mimeType: 'application/json',
        bytes: Buffer.from('{}'),
      },
    ]);

    await expect(
      service.processEvidenceDownload({
        contractId: CONTRACT_ID,
        providerEnvelopeReference: ENVELOPE_REF,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockUnitOfWork.run).toHaveBeenCalled();
  });

  it('fails if signed PDF has invalid signature in non-demo mode', async () => {
    mockContractsRead.findByProviderEnvelopeReference.mockResolvedValue({
      contract: {
        id: CONTRACT_ID,
        contractNumber: 'CTR-2026-TEST-0001',
        leadId: 'lead-1',
        organizationId: 'org-1',
        lifecycleStatus: 'PROVIDER_COMPLETED_EVIDENCE_PENDING',
      },
      version: { id: 'ver-1' },
    } as unknown as ContractWithCurrentVersion);

    mockProvider.downloadArtifacts.mockResolvedValue([
      {
        kind: 'SIGNED_PDF',
        fileName: 'contract-unsigned.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('%PDF-1.4 unsigned raw text %%EOF'),
      },
    ]);

    await expect(
      service.processEvidenceDownload({
        contractId: CONTRACT_ID,
        providerEnvelopeReference: ENVELOPE_REF,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(mockUnitOfWork.run).toHaveBeenCalled();
  });

  it('successfully downloads, verifies, encrypts and finalizes evidence', async () => {
    mockContractsRead.findByProviderEnvelopeReference.mockResolvedValue({
      contract: {
        id: CONTRACT_ID,
        contractNumber: 'CTR-2026-TEST-0001',
        leadId: 'lead-1',
        organizationId: 'org-1',
        lifecycleStatus: 'PROVIDER_COMPLETED_EVIDENCE_PENDING',
      },
      version: {
        id: 'ver-1',
        canonicalDocument: { sha256: 'c'.repeat(64) },
      },
    } as unknown as ContractWithCurrentVersion);

    const validSignedPdf = createValidSignedPdf();

    mockProvider.downloadArtifacts.mockResolvedValue([
      {
        kind: 'SIGNED_PDF',
        fileName: 'contract-signed.pdf',
        mimeType: 'application/pdf',
        bytes: validSignedPdf,
      },
      {
        kind: 'AUDIT_TRAIL',
        fileName: 'audit.json',
        mimeType: 'application/json',
        bytes: Buffer.from('{"audit":"trail"}'),
      },
    ]);

    const result = await service.processEvidenceDownload({
      contractId: CONTRACT_ID,
      providerEnvelopeReference: ENVELOPE_REF,
    });

    expect(result.success).toBe(true);
    expect(result.contractId).toBe(CONTRACT_ID);
    expect(result.manifestSha256).toBeDefined();
    expect(result.signedPdfSha256).toBeDefined();

    expect(mockDocumentService.encryptEvidenceArtifact).toHaveBeenCalledTimes(2);
    expect(mockStorage.writeFiles).toHaveBeenCalledTimes(1);
    expect(mockAggregateService.finalizeVerifiedProviderCompletion).toHaveBeenCalledTimes(1);
  });
});
