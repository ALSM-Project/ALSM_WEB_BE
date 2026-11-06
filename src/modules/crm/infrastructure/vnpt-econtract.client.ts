import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  VnptCancelContractRequest,
  VnptContractDetailResponse,
  VnptCreateContractRequest,
  VnptCreateContractResponse,
  VnptGeneralResponse,
  VnptSignerConfigRequest,
} from './vnpt-econtract.types';

interface VnptLoginResponse {
  message?: string;
  status?: string;
  statusCode?: number;
  object?: { accessToken?: string; expiresAt?: string };
}

/** Minimal server-to-server client for VNPT eContract. Never logs credentials or provider payloads. */
@Injectable()
export class VnptEContractClient {
  private accessToken?: string;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const environment = this.config.get<string>('VNPT_ECONTRACT_ENVIRONMENT')?.trim().toUpperCase();
    return Boolean(
      (environment === 'SANDBOX' || environment === 'PRODUCTION')
      &&
      this.config.get<string>('VNPT_ECONTRACT_CLIENT_ID')?.trim()
      && this.config.get<string>('VNPT_ECONTRACT_CLIENT_SECRET')?.trim()
      && this.config.get<string>('VNPT_ECONTRACT_USERNAME')?.trim()
      && this.config.get<string>('VNPT_ECONTRACT_PASSWORD')
      && this.config.get<string>('VNPT_ECONTRACT_CALLBACK_KEY')?.trim()
      && this.config.get<string>('VNPT_ECONTRACT_CALLBACK_SECRET')?.trim(),
    );
  }

  async postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  }

  async uploadMainPdf(input: { fileName: string; bytes: Buffer }): Promise<unknown> {
    const form = new FormData();
    form.append('rawData[0].orderNumber', '0');
    form.append('rawData[0].hopDongType', '1');
    form.append('rawData[0].flagCeca', '0');
    form.append('rawData[0].quyenXemId', '1');
    form.append('rawData[0].nhomTaiLieuId', '1');
    form.append('rawData[0].file', new Blob([new Uint8Array(input.bytes)], { type: 'application/pdf' }), input.fileName);
    return this.request('/econtract-saas-service/api/hopdong/upload-multi-files', {
      method: 'POST',
      body: form,
    });
  }

  async createContract(input: VnptCreateContractRequest): Promise<VnptCreateContractResponse> {
    return this.postJson<VnptCreateContractResponse>(
      '/econtract-saas-service/api/hopdong',
      input as unknown as Record<string, unknown>,
    );
  }

  async configureSigners(input: VnptSignerConfigRequest): Promise<VnptGeneralResponse> {
    return this.postJson<VnptGeneralResponse>(
      '/econtract-saas-service/api/hopdong/them-sua-nguoi-ky',
      input as unknown as Record<string, unknown>,
    );
  }

  async sendForSigning(hopDongId: number): Promise<VnptGeneralResponse> {
    if (!Number.isSafeInteger(hopDongId) || hopDongId < 1) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_INVALID_REFERENCE', message: 'Invalid contract reference.' });
    }
    return this.postJson<VnptGeneralResponse>(
      '/econtract-saas-service/api/hopdong/gui-hop-dong',
      { hopDongId },
    );
  }

  async getContractDetail(hopDongId: number): Promise<VnptContractDetailResponse> {
    if (!Number.isSafeInteger(hopDongId) || hopDongId < 1) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_INVALID_REFERENCE', message: 'Invalid contract reference.' });
    }
    return this.request<VnptContractDetailResponse>(
      `/econtract-saas-service/api/hopdong/chitiet/${hopDongId}`,
      { method: 'GET' },
    );
  }

  async cancelContract(input: VnptCancelContractRequest): Promise<VnptGeneralResponse> {
    if (!Number.isSafeInteger(input.hopDongId) || input.hopDongId < 1) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_INVALID_REFERENCE', message: 'Invalid contract reference.' });
    }
    return this.request<VnptGeneralResponse>(
      '/econtract-saas-service/api/hopdong/huy-hop-dong',
      {
        method: 'PUT',
        body: JSON.stringify(input),
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  async downloadContractFile(hopDongId: number, hopDongChiTietId: number): Promise<Buffer> {
    if (!Number.isSafeInteger(hopDongId) || hopDongId < 1 || !Number.isSafeInteger(hopDongChiTietId) || hopDongChiTietId < 1) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_INVALID_REFERENCE', message: 'The signing provider returned an invalid contract file reference.' });
    }
    const bytes = await this.request<ArrayBuffer>(
      `/econtract-saas-service/api/hopdong/${hopDongId}/tai-file/${hopDongChiTietId}`,
      { method: 'GET', responseType: 'arrayBuffer' },
    );
    return Buffer.from(bytes);
  }

  async downloadContractBundle(hopDongId: number): Promise<Buffer> {
    if (!Number.isSafeInteger(hopDongId) || hopDongId < 1) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_INVALID_REFERENCE', message: 'The signing provider returned an invalid contract reference.' });
    }
    const bytes = await this.request<ArrayBuffer>(
      `/econtract-saas-service/api/hopdong/tai-bo-hopdong?hopDongId=${hopDongId}`,
      { method: 'GET', responseType: 'arrayBuffer' },
    );
    return Buffer.from(bytes);
  }

  private async request<T>(
    path: string,
    input: RequestInit & { responseType?: 'json' | 'arrayBuffer' },
  ): Promise<T> {
    const baseUrl = this.resolveBaseUrl();
    const token = await this.getAccessToken(baseUrl);
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        ...input,
        headers: { ...input.headers, authorization: `Bearer ${token}`, accept: input.responseType === 'arrayBuffer' ? 'application/octet-stream' : 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_UNAVAILABLE', message: 'The signing provider is temporarily unavailable.' });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_REQUEST_FAILED', message: 'The signing provider could not process the request.' });
    }
    if (input.responseType === 'arrayBuffer') return await response.arrayBuffer() as T;
    const result = await response.json() as { message?: string; status?: string; statusCode?: number };
    if (result.message && result.message !== 'ECT-00000000') {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_REQUEST_REJECTED', message: 'The signing provider rejected the request.' });
    }
    return result as T;
  }

  private async getAccessToken(baseUrl: URL): Promise<string> {
    if (this.accessToken && Date.now() + 30_000 < this.tokenExpiresAt) return this.accessToken;
    const credentials = {
      client_id: this.config.get<string>('VNPT_ECONTRACT_CLIENT_ID')?.trim(),
      client_secret: this.config.get<string>('VNPT_ECONTRACT_CLIENT_SECRET'),
      taiKhoan: this.config.get<string>('VNPT_ECONTRACT_USERNAME')?.trim(),
      matKhau: this.config.get<string>('VNPT_ECONTRACT_PASSWORD'),
      nenTangId: 1,
    };
    if (!credentials.client_id || !credentials.client_secret || !credentials.taiKhoan || !credentials.matKhau) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_NOT_CONFIGURED', message: 'The signing provider is not configured.' });
    }
    let response: Response;
    try {
      response = await fetch(new URL('/users-profile-service/auth/login', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(credentials),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_UNAVAILABLE', message: 'The signing provider is temporarily unavailable.' });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_AUTH_FAILED', message: 'The signing provider could not authenticate the integration account.' });
    }
    const result = await response.json() as VnptLoginResponse;
    const accessToken = result.object?.accessToken;
    if (result.message !== 'ECT-00000000' || !accessToken) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_AUTH_FAILED', message: 'The signing provider could not authenticate the integration account.' });
    }
    const providerExpiry = result.object?.expiresAt ? Date.parse(result.object.expiresAt) : Number.NaN;
    this.accessToken = accessToken;
    this.tokenExpiresAt = Number.isFinite(providerExpiry) ? providerExpiry : Date.now() + 5 * 60_000;
    return accessToken;
  }

  private resolveBaseUrl(): URL {
    const environment = this.config.get<string>('VNPT_ECONTRACT_ENVIRONMENT')?.trim().toUpperCase();
    const baseUrl = environment === 'SANDBOX'
      ? 'https://gateway-bus-econtract-v2-poc.vnpt.vn/'
      : environment === 'PRODUCTION'
        ? 'https://gateway-bus-econtract.vnpt.vn/'
        : undefined;
    if (!baseUrl) {
      throw new ServiceUnavailableException({ code: 'VNPT_ECONTRACT_NOT_CONFIGURED', message: 'Select a supported signing-provider environment.' });
    }
    return new URL(baseUrl);
  }
}
