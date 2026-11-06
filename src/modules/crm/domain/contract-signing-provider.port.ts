export type SigningProviderEnvironment = 'DEMO' | 'SANDBOX' | 'PRODUCTION';
export type SigningSignerParty = 'ALSM' | 'CUSTOMER';
export type SigningProviderEnvelopeStatus = 'CREATED' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

export interface SigningProviderCapabilities {
  createSigningEnvelope: boolean;
  verifyWebhook: boolean;
  queryEnvelope: boolean;
  downloadSignedArtifacts: boolean;
  cancelEnvelope: boolean;
  sequentialSigners: boolean;
}

export interface SigningProviderReadiness {
  configured: boolean;
  providerKey?: string;
  environment?: SigningProviderEnvironment;
  capabilities: SigningProviderCapabilities;
}

export type SigningMethod = 'SMS_OTP' | 'EMAIL_OTP' | 'SMART_CA' | 'USB_TOKEN';

export interface StartSigningEnvelopeInput {
  idempotencyKey: string;
  contractId: string;
  contractVersionId: string;
  contractNumber: string;
  canonicalPdf: Buffer;
  canonicalPdfSha256: string;
  signatureMethod?: SigningMethod;
  signers: Array<{
    signerId: string;
    party: SigningSignerParty;
    fullName: string;
    email: string;
    phone?: string;
    sequence: number;
    signatureMethod?: SigningMethod;
  }>;
  expiresAt: Date;
}

export interface SigningProviderEnvelopeResult {
  providerEnvelopeReference: string;
  providerContractId?: string;
  status: Extract<SigningProviderEnvelopeStatus, 'CREATED' | 'SENT' | 'IN_PROGRESS'>;
  signerSessions?: Array<{
    signerId: string;
    url: string;
    expiresAt: Date;
  }>;
}

export interface VerifiedSigningProviderEvent {
  providerEventReference: string;
  providerEnvelopeReference: string;
  eventType: 'ENVELOPE_SENT' | 'SIGNER_VIEWED' | 'SIGNER_COMPLETED' | 'SIGNER_DECLINED' | 'ENVELOPE_COMPLETED' | 'ENVELOPE_EXPIRED' | 'ENVELOPE_CANCELLED';
  occurredAt: Date;
  payloadSha256: string;
  signerReference?: string;
  signerId?: string;
  signerDetails?: Array<{
    signerId: string;
    status: string;
    signedAt?: Date;
  }>;
}

export interface SigningProviderWebhookInput {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface SigningProviderArtifact {
  kind: 'SIGNED_PDF' | 'COMPLETION_CERTIFICATE' | 'AUDIT_TRAIL';
  fileName: string;
  mimeType: 'application/pdf' | 'application/json' | 'text/plain';
  bytes: Buffer;
}

/**
 * Provider integration boundary. Implementations must use provider-owned signer authentication,
 * verify webhook bytes before constructing VerifiedSigningProviderEvent, and never log secrets,
 * signer sessions, raw payloads, or document bytes.
 */
export interface ContractSigningProviderPort {
  getReadiness(): SigningProviderReadiness;
  createEnvelope(input: StartSigningEnvelopeInput): Promise<SigningProviderEnvelopeResult>;
  verifyWebhook(input: SigningProviderWebhookInput): Promise<VerifiedSigningProviderEvent | null>;
  getEnvelopeStatus(providerEnvelopeReference: string): Promise<SigningProviderEnvelopeStatus>;
  downloadArtifacts(providerEnvelopeReference: string): Promise<SigningProviderArtifact[]>;
  cancelEnvelope(providerEnvelopeReference: string, reason: string): Promise<void>;
  /** Available only on the explicit, non-production demo adapter. */
  completeDemoSignature?(input: {
    providerEnvelopeReference: string;
    signerId: string;
    acknowledged: true;
    occurredAt: Date;
  }): Promise<VerifiedSigningProviderEvent>;
}

export const CONTRACT_SIGNING_PROVIDER = Symbol('CONTRACT_SIGNING_PROVIDER');
