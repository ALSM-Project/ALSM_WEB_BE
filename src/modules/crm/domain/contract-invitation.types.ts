export type ContractInvitationStatus = 'ACTIVE' | 'REVOKED' | 'CONSUMED' | 'EXPIRED';
export type ContractInvitationDeliveryStatus =
  | 'PENDING'
  | 'SENT'
  | 'NOT_CONFIGURED'
  | 'FAILED'
  | 'UNCONFIRMED';

export interface ContractInvitationRecord {
  id: string;
  leadId: string;
  organizationId: string;
  email: string;
  createdByUserId: string;
  createRequestId: string;
  status: ContractInvitationStatus;
  deliveryStatus: ContractInvitationDeliveryStatus;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
  consumedAt?: Date;
  consumedByUserId?: string;
  registrationUserId?: string;
  lastDeliveryAttemptAt?: Date;
  lastResendRequestId?: string;
}

export type PhoneVerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
export type SigningEligibility = 'BLOCKED_PHONE_UNVERIFIED' | 'ELIGIBLE';

export interface ContractAccessGrantRecord {
  id: string;
  leadId: string;
  userId: string;
  invitationId: string;
  status: 'ACTIVE';
  phoneVerificationStatus: PhoneVerificationStatus;
  signingEligibility: SigningEligibility;
  verifiedPhone?: string;
  phoneVerifiedAt?: Date;
  createdAt: Date;
}

export interface CreateContractInvitationInput {
  leadId: string;
  organizationId: string;
  email: string;
  createdByUserId: string;
  requestId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}

export interface RotatedContractInvitationInput {
  invitationId: string;
  leadId: string;
  organizationId: string;
  requestId: string;
  tokenHash: string;
  expiresAt: Date;
  now: Date;
}

export interface AcceptContractInvitationInput {
  tokenHash: string;
  userId: string;
  email: string;
  now: Date;
}

export interface ContractInvitationRepository {
  expireExpiredForLeadEmail(leadId: string, email: string, now: Date): Promise<Array<{
    id: string;
    leadId: string;
    organizationId: string;
  }>>;
  createOrReplay(input: CreateContractInvitationInput): Promise<{
    invitation: ContractInvitationRecord;
    replayed: boolean;
  }>;
  listForLead(leadId: string, organizationId: string): Promise<ContractInvitationRecord[]>;
  findForLead(
    invitationId: string,
    leadId: string,
    organizationId: string,
  ): Promise<ContractInvitationRecord | null>;
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<ContractInvitationRecord | null>;
  claimRegistration(input: {
    tokenHash: string;
    claimId: string;
    now: Date;
    claimExpiresAt: Date;
  }): Promise<ContractInvitationRecord | null>;
  completeRegistrationClaim(input: {
    invitationId: string;
    claimId: string;
    userId: string;
    now: Date;
  }): Promise<boolean>;
  releaseRegistrationClaim(invitationId: string, claimId: string): Promise<boolean>;
  rotateToken(input: RotatedContractInvitationInput): Promise<{
    invitation: ContractInvitationRecord;
    replayed: boolean;
  } | null>;
  updateDelivery(input: {
    invitationId: string;
    tokenHash: string;
    status: ContractInvitationDeliveryStatus;
    attemptedAt: Date;
  }): Promise<void>;
  revoke(input: {
    invitationId: string;
    leadId: string;
    organizationId: string;
    now: Date;
  }): Promise<{ invitation: ContractInvitationRecord; changed: boolean } | null>;
  acceptAndGrant(input: AcceptContractInvitationInput): Promise<{
    grant: ContractAccessGrantRecord;
    replayed: boolean;
  } | null>;
  updatePhoneVerification(input: {
    userId: string;
    phone: string;
    status: PhoneVerificationStatus;
    eligibility: SigningEligibility;
  }): Promise<number>;
  findGrantByUserId(userId: string): Promise<ContractAccessGrantRecord | null>;
  consumePublicRateLimit(input: {
    clientAddress: string;
    action: string;
    now: Date;
    windowMs: number;
  }): Promise<number>;
}

export const CONTRACT_INVITATION_REPOSITORY = Symbol('CONTRACT_INVITATION_REPOSITORY');
