import { ConfigService } from '@nestjs/config';
import { VnptContractSigningProviderAdapter } from '../src/modules/crm/infrastructure/vnpt-contract-signing-provider.adapter';
import type { VnptEContractClient } from '../src/modules/crm/infrastructure/vnpt-econtract.client';
import type { StartSigningEnvelopeInput } from '../src/modules/crm/domain/contract-signing-provider.port';

describe('VnptContractSigningProviderAdapter', () => {
  let adapter: VnptContractSigningProviderAdapter;
  let client: jest.Mocked<VnptEContractClient>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(() => {
    client = {
      isConfigured: jest.fn().mockReturnValue(true),
      uploadMainPdf: jest.fn().mockResolvedValue({
        message: 'ECT-00000000',
        object: [{ fileId: 101, hopDongChiTietId: 202 }],
      }),
      createContract: jest.fn().mockResolvedValue({
        message: 'ECT-00000000',
        object: { hopDongId: 999, soHopDong: 'HD-2026-001', trangThai: 0 },
      }),
      configureSigners: jest.fn().mockResolvedValue({ message: 'ECT-00000000' }),
      sendForSigning: jest.fn().mockResolvedValue({ message: 'ECT-00000000' }),
      getContractDetail: jest.fn().mockResolvedValue({
        message: 'ECT-00000000',
        object: {
          hopDongId: 999,
          trangThai: 3, // COMPLETED
          danhSachFile: [{ fileId: 101, tenFile: 'contract.pdf' }],
        },
      }),
      downloadContractFile: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 signed')),
      downloadContractBundle: jest.fn().mockResolvedValue(Buffer.from('PK-zip-bundle')),
      cancelContract: jest.fn().mockResolvedValue({ message: 'ECT-00000000' }),
    } as unknown as jest.Mocked<VnptEContractClient>;

    config = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'VNPT_ECONTRACT_ENVIRONMENT':
            return 'SANDBOX';
          case 'VNPT_ECONTRACT_CALLBACK_KEY':
            return 'valid-cb-key';
          case 'VNPT_ECONTRACT_CALLBACK_SECRET':
            return 'valid-cb-secret';
          default:
            return undefined;
        }
      }),
    } as unknown as jest.Mocked<ConfigService>;

    adapter = new VnptContractSigningProviderAdapter(client, config);
  });

  describe('getReadiness', () => {
    it('reports configured true and all capabilities when client is configured', () => {
      const readiness = adapter.getReadiness();

      expect(readiness.configured).toBe(true);
      expect(readiness.providerKey).toBe('VNPT_ECONTRACT');
      expect(readiness.environment).toBe('SANDBOX');
      expect(readiness.capabilities.createSigningEnvelope).toBe(true);
      expect(readiness.capabilities.verifyWebhook).toBe(true);
      expect(readiness.capabilities.downloadSignedArtifacts).toBe(true);
    });

    it('reports configured false when client is not configured', () => {
      client.isConfigured.mockReturnValueOnce(false);

      const readiness = adapter.getReadiness();

      expect(readiness.configured).toBe(false);
      expect(readiness.capabilities.createSigningEnvelope).toBe(false);
    });
  });

  describe('createEnvelope', () => {
    const input: StartSigningEnvelopeInput = {
      idempotencyKey: 'idemp-1',
      contractId: 'ctr-1',
      contractVersionId: 'ver-1',
      contractNumber: 'HD-2026-001',
      canonicalPdf: Buffer.from('%PDF-1.4 unsigned'),
      canonicalPdfSha256: 'abc123sha256',
      signers: [
        {
          signerId: 'signer-alsm',
          party: 'ALSM',
          fullName: 'Nguyen Van A',
          email: 'sales@alsm.vn',
          sequence: 1,
        },
        {
          signerId: 'signer-customer',
          party: 'CUSTOMER',
          fullName: 'Tran Van B',
          email: 'customer@example.com',
          phone: '+84901234567',
          sequence: 2,
        },
      ],
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    };

    it('uploads PDF, creates contract, configures signers, and sends for signing', async () => {
      const result = await adapter.createEnvelope(input);

      expect(result.providerEnvelopeReference).toBe('999');
      expect(result.status).toBe('SENT');
      expect(client.uploadMainPdf).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: 'HD-2026-001.pdf' }),
      );
      expect(client.createContract).toHaveBeenCalledWith(
        expect.objectContaining({ soHopDong: 'HD-2026-001', danhSachFileId: [101] }),
      );
      expect(client.configureSigners).toHaveBeenCalledWith(
        expect.objectContaining({ hopDongId: 999 }),
      );
      expect(client.sendForSigning).toHaveBeenCalledWith(999);
    });

    it('rolls back with cancelContract if configureSigners fails', async () => {
      client.configureSigners.mockRejectedValueOnce(new Error('Signer Config Error'));

      await expect(adapter.createEnvelope(input)).rejects.toThrow('Signer Config Error');
      expect(client.cancelContract).toHaveBeenCalledWith({
        hopDongId: 999,
        lyDoHuy: expect.stringContaining('Lỗi thiết lập người ký'),
      });
    });
  });

  describe('verifyWebhook', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        hopDongId: 999,
        trangThai: 3,
        thoiGianXuLy: '2026-11-06T12:00:00Z',
        danhSachNguoiKy: [
          { nguoiKyId: 1, trangThaiKy: 1, thoiGianKy: '2026-11-06T12:00:00Z' },
        ],
      }),
    );

    it('verifies valid webhook callback with correct secrets', async () => {
      const event = await adapter.verifyWebhook({
        rawBody,
        headers: {
          'x-app-cb-key': 'valid-cb-key',
          'x-app-cb-secret': 'valid-cb-secret',
        },
      });

      expect(event).not.toBeNull();
      expect(event?.providerEnvelopeReference).toBe('999');
      expect(event?.eventType).toBe('ENVELOPE_COMPLETED');
      expect(event?.signerDetails).toHaveLength(1);
      expect(event?.signerDetails?.[0].status).toBe('COMPLETED');
    });

    it('returns null on invalid secret', async () => {
      const event = await adapter.verifyWebhook({
        rawBody,
        headers: {
          'x-app-cb-key': 'wrong-key',
          'x-app-cb-secret': 'valid-cb-secret',
        },
      });

      expect(event).toBeNull();
    });

    it('returns null on malformed body', async () => {
      const event = await adapter.verifyWebhook({
        rawBody: Buffer.from('invalid json'),
        headers: {
          'x-app-cb-key': 'valid-cb-key',
          'x-app-cb-secret': 'valid-cb-secret',
        },
      });

      expect(event).toBeNull();
    });
  });

  describe('getEnvelopeStatus', () => {
    it.each([
      [0, 'CREATED'],
      [1, 'SENT'],
      [2, 'IN_PROGRESS'],
      [3, 'COMPLETED'],
      [4, 'DECLINED'],
      [5, 'CANCELLED'],
      [6, 'EXPIRED'],
    ])('maps VNPT status code %i to internal status %s', async (code, expected) => {
      client.getContractDetail.mockResolvedValueOnce({
        object: { hopDongId: 999, trangThai: code },
      });

      const status = await adapter.getEnvelopeStatus('999');
      expect(status).toBe(expected);
    });
  });

  describe('downloadArtifacts', () => {
    it('downloads signed contract files and zip bundle', async () => {
      const artifacts = await adapter.downloadArtifacts('999');

      expect(artifacts.length).toBeGreaterThanOrEqual(1);
      expect(artifacts[0].kind).toBe('SIGNED_PDF');
      expect(client.downloadContractFile).toHaveBeenCalledWith(999, 101);
      expect(client.downloadContractBundle).toHaveBeenCalledWith(999);
    });
  });

  describe('cancelEnvelope', () => {
    it('calls client cancelContract with contract ID and reason', async () => {
      await adapter.cancelEnvelope('999', 'Customer request cancellation');

      expect(client.cancelContract).toHaveBeenCalledWith({
        hopDongId: 999,
        lyDoHuy: 'Customer request cancellation',
      });
    });
  });
});

