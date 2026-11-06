import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  ContractSigningProviderPort,
  SigningProviderArtifact,
  SigningProviderEnvelopeResult,
  SigningProviderEnvelopeStatus,
  SigningProviderReadiness,
  SigningProviderWebhookInput,
  StartSigningEnvelopeInput,
  VerifiedSigningProviderEvent,
} from '../domain/contract-signing-provider.port';
import { VnptEContractClient } from './vnpt-econtract.client';
import type { VnptContractDetailResponse } from './vnpt-econtract.types';

@Injectable()
export class VnptContractSigningProviderAdapter implements ContractSigningProviderPort {
  private readonly logger = new Logger(VnptContractSigningProviderAdapter.name);

  constructor(
    private readonly client: VnptEContractClient,
    private readonly config: ConfigService,
  ) {}

  getReadiness(): SigningProviderReadiness {
    const isConfigured = this.client.isConfigured();
    const env = this.config.get<string>('VNPT_ECONTRACT_ENVIRONMENT')?.trim().toUpperCase();
    const environment = env === 'SANDBOX' ? 'SANDBOX' : env === 'PRODUCTION' ? 'PRODUCTION' : undefined;

    return {
      configured: isConfigured,
      providerKey: 'VNPT_ECONTRACT',
      environment,
      capabilities: {
        createSigningEnvelope: isConfigured,
        verifyWebhook: isConfigured,
        queryEnvelope: isConfigured,
        downloadSignedArtifacts: isConfigured,
        cancelEnvelope: isConfigured,
        sequentialSigners: isConfigured,
      },
    };
  }

  async createEnvelope(input: StartSigningEnvelopeInput): Promise<SigningProviderEnvelopeResult> {
    this.assertConfigured();

    // Step 1: Upload canonical unsigned PDF
    const uploadResult = (await this.client.uploadMainPdf({
      fileName: `${input.contractNumber}.pdf`,
      bytes: input.canonicalPdf,
    })) as { object?: Array<{ fileId: number; hopDongChiTietId?: number }> };

    const uploadedFile = uploadResult?.object?.[0];
    if (!uploadedFile?.fileId) {
      throw new ServiceUnavailableException({
        code: 'VNPT_UPLOAD_FAILED',
        message: 'Failed to upload contract document to VNPT eContract.',
      });
    }

    // Step 2: Create contract draft on VNPT
    const createResult = await this.client.createContract({
      tenHopDong: `Hợp đồng ${input.contractNumber}`,
      soHopDong: input.contractNumber,
      hinhThucKy: 1, // Default OTP/Digital sign
      danhSachFileId: [uploadedFile.fileId],
      ngayHetHan: input.expiresAt.toISOString(),
    });

    const hopDongId = createResult.object?.hopDongId;
    if (!hopDongId) {
      throw new ServiceUnavailableException({
        code: 'VNPT_CONTRACT_CREATION_FAILED',
        message: 'Failed to create contract envelope on VNPT eContract.',
      });
    }

    try {
      // Step 3: Configure signers
      await this.client.configureSigners({
        hopDongId,
        nguoiKy: input.signers.map((signer, idx) => ({
          stt: idx + 1,
          hoVaTen: signer.fullName,
          email: signer.email,
          soDienThoai: signer.phone,
          loaiNguoiKy: signer.party === 'CUSTOMER' ? 1 : 2,
          hinhThucKy: signer.signatureMethod === 'SMART_CA' ? 3 : signer.signatureMethod === 'EMAIL_OTP' ? 2 : 1, // 1: SMS OTP
          thuTuKy: signer.sequence,
        })),
      });

      // Step 4: Send for signing
      await this.client.sendForSigning(hopDongId);
    } catch (error) {
      // Rollback: try to cancel the created contract on error
      try {
        await this.client.cancelContract({
          hopDongId,
          lyDoHuy: 'Lỗi thiết lập người ký hoặc gửi hợp đồng từ ALSM',
        });
      } catch (rollbackError) {
        this.logger.warn(`Failed to rollback VNPT contract ${hopDongId}: ${String(rollbackError)}`);
      }
      throw error;
    }

    return {
      providerEnvelopeReference: String(hopDongId),
      providerContractId: String(hopDongId),
      status: 'SENT',
    };
  }

  async verifyWebhook(input: SigningProviderWebhookInput): Promise<VerifiedSigningProviderEvent | null> {
    const expectedKey = this.config.get<string>('VNPT_ECONTRACT_CALLBACK_KEY')?.trim();
    const expectedSecret = this.config.get<string>('VNPT_ECONTRACT_CALLBACK_SECRET')?.trim();

    if (!expectedKey || !expectedSecret) return null;

    const headerKey = this.extractHeader(input.headers, 'x-app-cb-key');
    const headerSecret = this.extractHeader(input.headers, 'x-app-cb-secret');

    if (!headerKey || !headerSecret) return null;

    // Constant-time comparison
    if (!this.safeCompare(headerKey, expectedKey) || !this.safeCompare(headerSecret, expectedSecret)) {
      this.logger.warn('Webhook callback secret mismatch from VNPT provider.');
      return null;
    }

    try {
      const payload = JSON.parse(input.rawBody.toString('utf8')) as {
        hopDongId?: number;
        trangThai?: number;
        thoiGianXuLy?: string;
        danhSachNguoiKy?: Array<{
          nguoiKyId?: number;
          trangThaiKy?: number;
          thoiGianKy?: string;
        }>;
      };

      if (!payload.hopDongId || payload.trangThai === undefined) {
        return null;
      }

      const payloadSha256 = createHash('sha256').update(input.rawBody).digest('hex');
      const eventType = this.mapVnptStatusToEventType(payload.trangThai);

      return {
        providerEventReference: `vnpt-${payload.hopDongId}-${Date.now()}`,
        providerEnvelopeReference: String(payload.hopDongId),
        eventType,
        occurredAt: payload.thoiGianXuLy ? new Date(payload.thoiGianXuLy) : new Date(),
        payloadSha256,
        signerDetails: payload.danhSachNguoiKy?.map((s) => ({
          signerId: String(s.nguoiKyId ?? ''),
          status: s.trangThaiKy === 1 ? 'COMPLETED' : s.trangThaiKy === 2 ? 'DECLINED' : 'PENDING',
          signedAt: s.thoiGianKy ? new Date(s.thoiGianKy) : undefined,
        })),
      };
    } catch {
      return null;
    }
  }

  async getEnvelopeStatus(providerEnvelopeReference: string): Promise<SigningProviderEnvelopeStatus> {
    this.assertConfigured();
    const hopDongId = Number(providerEnvelopeReference);
    const detail = await this.client.getContractDetail(hopDongId);
    const statusNumber = detail.object?.trangThai;

    switch (statusNumber) {
      case 0:
        return 'CREATED';
      case 1:
        return 'SENT';
      case 2:
        return 'IN_PROGRESS';
      case 3:
        return 'COMPLETED';
      case 4:
        return 'DECLINED';
      case 5:
        return 'CANCELLED';
      case 6:
        return 'EXPIRED';
      default:
        return 'IN_PROGRESS';
    }
  }

  async downloadArtifacts(providerEnvelopeReference: string): Promise<SigningProviderArtifact[]> {
    this.assertConfigured();
    const hopDongId = Number(providerEnvelopeReference);

    const detail: VnptContractDetailResponse = await this.client.getContractDetail(hopDongId);
    const files = detail.object?.danhSachFile ?? [];

    const artifacts: SigningProviderArtifact[] = [];

    // Download each file listed on the contract
    for (const file of files) {
      if (file.fileId) {
        const fileBytes = await this.client.downloadContractFile(hopDongId, file.fileId);
        artifacts.push({
          kind: 'SIGNED_PDF',
          fileName: file.tenFile || `contract-${hopDongId}.pdf`,
          mimeType: 'application/pdf',
          bytes: fileBytes,
        });
      }
    }

    // Try downloading bundle (audit / certificate) if available
    try {
      const bundleBytes = await this.client.downloadContractBundle(hopDongId);
      if (bundleBytes && bundleBytes.length > 0) {
        artifacts.push({
          kind: 'AUDIT_TRAIL',
          fileName: `contract-${hopDongId}-bundle.zip`,
          mimeType: 'application/json',
          bytes: bundleBytes,
        });
      }
    } catch (e) {
      this.logger.debug(`Bundle download not available for contract ${hopDongId}: ${String(e)}`);
    }

    return artifacts;
  }

  async cancelEnvelope(providerEnvelopeReference: string, reason: string): Promise<void> {
    this.assertConfigured();
    const hopDongId = Number(providerEnvelopeReference);
    await this.client.cancelContract({
      hopDongId,
      lyDoHuy: reason,
    });
  }

  private assertConfigured(): void {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'VNPT_ECONTRACT_NOT_CONFIGURED',
        message: 'VNPT eContract signing provider is not fully configured.',
      });
    }
  }

  private extractHeader(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | undefined {
    const val = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()];
    return Array.isArray(val) ? val[0] : val;
  }

  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  private mapVnptStatusToEventType(
    status: number,
  ): VerifiedSigningProviderEvent['eventType'] {
    switch (status) {
      case 1:
        return 'ENVELOPE_SENT';
      case 2:
        return 'SIGNER_COMPLETED';
      case 3:
        return 'ENVELOPE_COMPLETED';
      case 4:
        return 'SIGNER_DECLINED';
      case 5:
        return 'ENVELOPE_CANCELLED';
      case 6:
        return 'ENVELOPE_EXPIRED';
      default:
        return 'SIGNER_COMPLETED';
    }
  }
}

