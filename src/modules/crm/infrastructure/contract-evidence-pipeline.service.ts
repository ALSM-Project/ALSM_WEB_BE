import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  CONTRACT_AGGREGATE_REPOSITORY,
  type ContractAggregateRepository,
  type ContractFinalEvidenceArtifact,
  type ContractFinalEvidenceManifest,
} from '../domain/contract-aggregate.types';
import {
  CONTRACT_SIGNING_PROVIDER,
  type ContractSigningProviderPort,
  type VerifiedSigningProviderEvent,
} from '../domain/contract-signing-provider.port';
import {
  CONTRACT_AGGREGATE_UNIT_OF_WORK,
  type ContractAggregateUnitOfWork,
} from '../application/contract-aggregate-unit-of-work.port';
import { ContractAggregateService } from '../application/contract-aggregate.service';
import { ContractReviewDocumentService } from '../application/contract-review-document.service';
import { STORAGE_PORT, type StoragePort } from '../../../shared/storage/storage.port';
import { calculateFinalEvidenceManifestSha256 } from '../domain/contract-final-evidence';
import { PdfSignatureVerifier } from '../domain/pdf-signature-verifier';

export interface ProcessEvidenceDownloadResult {
  success: boolean;
  replayed?: boolean;
  contractId: string;
  signedPdfSha256?: string;
  manifestSha256?: string;
}

@Injectable()
export class ContractEvidencePipelineService {
  private readonly logger = new Logger(ContractEvidencePipelineService.name);

  constructor(
    @Inject(CONTRACT_SIGNING_PROVIDER)
    private readonly signingProvider: ContractSigningProviderPort,
    @Inject(CONTRACT_AGGREGATE_REPOSITORY)
    private readonly contractsRead: ContractAggregateRepository,
    @Inject(CONTRACT_AGGREGATE_UNIT_OF_WORK)
    private readonly unitOfWork: ContractAggregateUnitOfWork,
    private readonly contractAggregateService: ContractAggregateService,
    private readonly documentService: ContractReviewDocumentService,
    @Inject(STORAGE_PORT)
    private readonly storage: StoragePort,
    private readonly config: ConfigService,
  ) {}

  /**
   * Downloads completed envelope artifacts from the signing provider,
   * performs cryptographic and structural PDF signature verification,
   * encrypts artifacts using AES-256-GCM, stores them to private storage,
   * and finalizes verified completion on the contract aggregate.
   */
  async processEvidenceDownload(input: {
    contractId: string;
    providerEnvelopeReference: string;
    occurredAt?: Date;
    eventReference?: string;
  }): Promise<ProcessEvidenceDownloadResult> {
    const contract = await this.contractsRead.findByProviderEnvelopeReference(
      input.providerEnvelopeReference,
    );

    if (!contract || contract.contract.id !== input.contractId) {
      throw new NotFoundException({
        code: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found for the given provider envelope reference.',
      });
    }

    // Idempotency: if already completed and evidence verified, return immediately
    if (
      contract.contract.lifecycleStatus === 'COMPLETED'
      && contract.contract.archiveStatus === 'VERIFIED'
      && contract.contract.finalEvidence
    ) {
      this.logger.log(`Evidence already finalized for contract ${input.contractId}, skipping.`);
      return {
        success: true,
        replayed: true,
        contractId: input.contractId,
        manifestSha256: contract.contract.finalEvidence.manifestSha256,
        signedPdfSha256: contract.contract.finalEvidence.signedPdf.sha256,
      };
    }

    const readiness = this.signingProvider.getReadiness();
    if (!readiness.configured || !readiness.providerKey) {
      throw new ConflictException({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Signing provider is not configured to download completion evidence.',
      });
    }

    const mode = this.config.get<string>('CONTRACT_SIGNING_MODE');
    const isDemoMode = mode === 'DEMO';

    try {
      // 1. Download artifacts from provider
      const downloadedArtifacts = await this.signingProvider.downloadArtifacts(
        input.providerEnvelopeReference,
      );

      if (!downloadedArtifacts || downloadedArtifacts.length === 0) {
        throw new ConflictException({
          code: 'NO_ARTIFACTS_RETURNED',
          message: 'Signing provider did not return any artifacts for completed contract.',
        });
      }

      const signedPdfItem = downloadedArtifacts.find((art) => art.kind === 'SIGNED_PDF');
      if (!signedPdfItem) {
        throw new ConflictException({
          code: 'SIGNED_PDF_MISSING',
          message: 'Signing provider artifacts do not contain a signed PDF document.',
        });
      }

      // 2. Cryptographic & structural verification of signed PDF
      if (!isDemoMode) {
        const verificationResult = PdfSignatureVerifier.verify(signedPdfItem.bytes);
        if (!verificationResult.valid) {
          this.logger.error(
            `Signed PDF signature verification failed for contract ${input.contractId}: ${verificationResult.issues.join(', ')}`,
          );
          throw new ConflictException({
            code: 'PDF_SIGNATURE_VERIFICATION_FAILED',
            message: `The signed PDF does not contain a valid digital signature: ${verificationResult.issues.join('; ')}`,
          });
        }
      }

      // 3. Encrypt signed PDF using AES-256-GCM
      const pdfFileName = signedPdfItem.fileName || `contract-${contract.contract.contractNumber}-signed.pdf`;
      const encryptedPdf = this.documentService.encryptEvidenceArtifact(
        signedPdfItem.bytes,
        pdfFileName,
      );

      // 4. Encrypt supporting artifacts
      const supportingItems = downloadedArtifacts.filter((art) => art.kind !== 'SIGNED_PDF');
      const encryptedSupportingList: {
        encrypted: ReturnType<ContractReviewDocumentService['encryptEvidenceArtifact']>;
        kind: 'COMPLETION_CERTIFICATE' | 'AUDIT_TRAIL';
        mimeType: 'application/pdf' | 'application/json' | 'text/plain';
      }[] = [];

      for (const item of supportingItems) {
        const encrypted = this.documentService.encryptEvidenceArtifact(
          item.bytes,
          item.fileName || `artifact-${item.kind.toLowerCase()}`,
        );
        const mimeType: 'application/pdf' | 'application/json' | 'text/plain' =
          item.mimeType === 'application/pdf' ? 'application/pdf' : 'application/json';
        encryptedSupportingList.push({
          encrypted,
          kind: item.kind === 'COMPLETION_CERTIFICATE' ? 'COMPLETION_CERTIFICATE' : 'AUDIT_TRAIL',
          mimeType,
        });
      }

      // 5. Store encrypted files into private storage
      const storageScope = `private/contracts/${contract.contract.id}/${contract.version.id}/evidence/${input.providerEnvelopeReference}`;
      const filesToWrite = [
        { relativePath: 'signed-pdf.pdf.aesgcm', content: encryptedPdf.bytes },
        ...encryptedSupportingList.map((item, index) => ({
          relativePath: `supporting-${index + 1}-${item.encrypted.fileName}.aesgcm`,
          content: item.encrypted.bytes,
        })),
      ];

      const storageReference = await this.storage.writeFiles(storageScope, filesToWrite);
      const archivedAt = new Date();

      const signedPdfArtifact: ContractFinalEvidenceArtifact = {
        kind: 'SIGNED_PDF',
        storageReference,
        fileName: encryptedPdf.fileName,
        mimeType: 'application/pdf',
        sha256: encryptedPdf.sha256,
        byteLength: encryptedPdf.byteLength,
        encryption: 'AES-256-GCM',
        encryptionKeyVersion: encryptedPdf.encryptionKeyVersion,
        archivedAt,
      };

      const supportingArtifacts: ContractFinalEvidenceArtifact[] = encryptedSupportingList.map((item) => ({
        kind: item.kind,
        storageReference,
        fileName: item.encrypted.fileName,
        mimeType: item.mimeType,
        sha256: item.encrypted.sha256,
        byteLength: item.encrypted.byteLength,
        encryption: 'AES-256-GCM',
        encryptionKeyVersion: item.encrypted.encryptionKeyVersion,
        archivedAt,
      }));

      // 6. Build final evidence manifest
      const canonicalDocumentSha256 =
        contract.version.canonicalDocument?.sha256
        ?? contract.contract.providerSigningSession?.canonicalDocumentSha256
        ?? '';

      const providerCompletedAt = input.occurredAt ?? new Date();
      const providerCompletionEventReference =
        input.eventReference ?? `event-${input.providerEnvelopeReference}-${providerCompletedAt.getTime()}`;

      const manifest: ContractFinalEvidenceManifest = {
        contractVersionId: contract.version.id,
        canonicalDocumentSha256,
        providerKey: readiness.providerKey,
        providerEnvelopeReference: input.providerEnvelopeReference,
        providerCompletionEventReference,
        providerCompletedAt,
        archivedAt,
        manifestSha256: '',
        signedPdf: signedPdfArtifact,
        supportingArtifacts,
      };

      manifest.manifestSha256 = calculateFinalEvidenceManifestSha256(manifest);

      const event: VerifiedSigningProviderEvent = {
        providerEnvelopeReference: input.providerEnvelopeReference,
        providerEventReference: providerCompletionEventReference,
        eventType: 'ENVELOPE_COMPLETED',
        occurredAt: providerCompletedAt,
        payloadSha256: createHash('sha256').update(input.providerEnvelopeReference).digest('hex'),
      };

      // 7. Finalize completion on aggregate
      await this.contractAggregateService.finalizeVerifiedProviderCompletion({
        contractId: contract.contract.id,
        leadId: contract.contract.leadId,
        organizationId: contract.contract.organizationId,
        versionId: contract.version.id,
        event,
        manifest,
      });

      this.logger.log(
        `Contract evidence pipeline completed successfully for contract ${contract.contract.id} (${contract.contract.contractNumber})`,
      );

      return {
        success: true,
        contractId: contract.contract.id,
        manifestSha256: manifest.manifestSha256,
        signedPdfSha256: signedPdfArtifact.sha256,
      };
    } catch (error) {
      this.logger.error(
        `Failed to process evidence download for contract ${input.contractId}: ${String(error)}`,
      );

      // Transition status to PROVIDER_COMPLETED_EVIDENCE_FAILED
      await this.unitOfWork.run(async ({ contracts, audit }) => {
        await contracts.updateProviderSigningStatus({
          contractId: contract.contract.id,
          providerEnvelopeReference: input.providerEnvelopeReference,
          status: 'PROVIDER_COMPLETED_EVIDENCE_FAILED',
          eventReference: input.eventReference,
          now: new Date(),
        });

        await audit.appendOnce(
          `contract-evidence-failed:${contract.contract.id}:${Date.now()}`,
          {
            actorUserId: 'system:contract-evidence-pipeline',
            organizationId: contract.contract.organizationId,
            action: 'CONTRACT_EVIDENCE_ARCHIVE_FAILED',
            resourceType: 'CONTRACT',
            resourceId: contract.contract.id,
            metadata: {
              providerEnvelopeReference: input.providerEnvelopeReference,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        );
      }, `evidence-pipeline-failed:${contract.contract.id}`);

      throw error;
    }
  }
}
