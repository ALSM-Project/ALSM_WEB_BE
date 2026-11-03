import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  ContractSigningProviderPort,
  SigningProviderArtifact,
  SigningProviderEnvelopeStatus,
  SigningProviderEnvelopeResult,
  SigningProviderReadiness,
  SigningProviderWebhookInput,
  StartSigningEnvelopeInput,
  VerifiedSigningProviderEvent,
} from '../domain/contract-signing-provider.port';

@Injectable()
export class UnconfiguredContractSigningProviderAdapter implements ContractSigningProviderPort {
  getReadiness(): SigningProviderReadiness {
    return {
      configured: false,
      capabilities: {
        createSigningEnvelope: false,
        verifyWebhook: false,
        queryEnvelope: false,
        downloadSignedArtifacts: false,
        cancelEnvelope: false,
        sequentialSigners: false,
      },
    };
  }

  createEnvelope(input: StartSigningEnvelopeInput): Promise<SigningProviderEnvelopeResult> {
    void input;
    return this.unavailable();
  }

  async verifyWebhook(input: SigningProviderWebhookInput): Promise<VerifiedSigningProviderEvent | null> {
    void input;
    return null;
  }

  getEnvelopeStatus(providerEnvelopeReference: string): Promise<SigningProviderEnvelopeStatus> {
    void providerEnvelopeReference;
    return this.unavailable();
  }

  downloadArtifacts(providerEnvelopeReference: string): Promise<SigningProviderArtifact[]> {
    void providerEnvelopeReference;
    return this.unavailable();
  }

  cancelEnvelope(providerEnvelopeReference: string, reason: string): Promise<void> {
    void providerEnvelopeReference;
    void reason;
    return this.unavailable();
  }

  private unavailable<T>(): Promise<T> {
    return Promise.reject(new ServiceUnavailableException({
      code: 'SIGNING_PROVIDER_NOT_CONFIGURED',
      message: 'Online signing is unavailable until an approved provider adapter and sandbox configuration are installed.',
    }));
  }
}
