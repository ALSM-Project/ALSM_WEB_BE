import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ContractSigningProviderPort,
  SigningProviderArtifact,
  SigningProviderEnvelopeStatus,
  SigningProviderReadiness,
  SigningProviderWebhookInput,
  StartSigningEnvelopeInput,
  VerifiedSigningProviderEvent,
} from '../domain/contract-signing-provider.port';

/** Local workflow simulator. It is deliberately not a legally-valid signature provider. */
@Injectable()
export class DemoContractSigningProviderAdapter implements ContractSigningProviderPort {
  getReadiness(): SigningProviderReadiness {
    return {
      configured: true,
      providerKey: 'ALSM_DEMO',
      environment: 'DEMO',
      capabilities: {
        createSigningEnvelope: true,
        verifyWebhook: true,
        queryEnvelope: true,
        downloadSignedArtifacts: true,
        cancelEnvelope: true,
        sequentialSigners: true,
      },
    };
  }

  async createEnvelope(input: StartSigningEnvelopeInput) {
    if (!input.canonicalPdf.byteLength || !/^[a-f\d]{64}$/i.test(input.canonicalPdfSha256)) {
      throw new ConflictException({ code: 'DEMO_SIGNING_DOCUMENT_INVALID', message: 'The approved contract PDF is unavailable for the demo signing flow.' });
    }
    return {
      providerEnvelopeReference: `demo-${randomUUID()}`,
      status: 'SENT' as const,
    };
  }

  async completeDemoSignature(input: {
    providerEnvelopeReference: string;
    signerId: string;
    acknowledged: true;
    occurredAt: Date;
  }): Promise<VerifiedSigningProviderEvent> {
    if (!/^demo-[0-9a-f-]{36}$/i.test(input.providerEnvelopeReference) || !input.signerId || input.acknowledged !== true) {
      throw new ConflictException({ code: 'DEMO_SIGNING_CONFIRMATION_INVALID', message: 'The demo signing confirmation is invalid.' });
    }
    const payload = JSON.stringify({
      providerEnvelopeReference: input.providerEnvelopeReference,
      signerId: input.signerId,
      acknowledged: input.acknowledged,
      occurredAt: input.occurredAt.toISOString(),
      notice: 'DEMO_ONLY_NOT_LEGALLY_SIGNED',
    });
    return {
      providerEventReference: `${input.providerEnvelopeReference}:completed`,
      providerEnvelopeReference: input.providerEnvelopeReference,
      eventType: 'ENVELOPE_COMPLETED',
      occurredAt: input.occurredAt,
      payloadSha256: createHash('sha256').update(payload).digest('hex'),
      signerId: input.signerId,
    };
  }

  async verifyWebhook(_input: SigningProviderWebhookInput) {
    return null;
  }

  async getEnvelopeStatus(_providerEnvelopeReference: string): Promise<SigningProviderEnvelopeStatus> {
    return 'SENT';
  }

  async downloadArtifacts(_providerEnvelopeReference: string): Promise<SigningProviderArtifact[]> {
    throw new ServiceUnavailableException({ code: 'DEMO_SIGNING_ACTION_REQUIRED', message: 'Complete the customer demo confirmation to create demo evidence.' });
  }

  async cancelEnvelope(_providerEnvelopeReference: string, _reason: string): Promise<void> {
    throw new ServiceUnavailableException({ code: 'DEMO_SIGNING_CANNOT_CANCEL', message: 'This demo signing session cannot be cancelled after it starts.' });
  }
}
