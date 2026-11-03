export type ContractEmailOutboxStatus = 'PENDING' | 'PROCESSING' | 'RETRY' | 'BLOCKED_CONFIGURATION' | 'SENT' | 'DEAD';
export type ContractEmailDeliveryResult = 'SENT' | 'NOT_CONFIGURED' | 'UNCONFIRMED' | 'FAILED';

export interface EnqueueContractEmailInput {
  eventKey: string;
  contractId: string;
  organizationId: string;
  actorUserId: string;
  recipientUserId: string;
  recipientEmail: string;
  subject: string;
  text: string;
  html: string;
  now: Date;
}

export interface ContractEmailOutboxRecord extends Omit<EnqueueContractEmailInput, 'now'> {
  id: string;
  status: ContractEmailOutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  leaseToken?: string;
  leaseExpiresAt?: Date;
  lastDeliveryResult?: ContractEmailDeliveryResult;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractNotificationEmailOutboxRepository {
  enqueue(input: EnqueueContractEmailInput, session?: import('mongoose').ClientSession): Promise<void>;
  claimNext(input: { now: Date; leaseToken: string; leaseExpiresAt: Date }): Promise<ContractEmailOutboxRecord | null>;
  settle(input: {
    id: string;
    leaseToken: string;
    status: Exclude<ContractEmailOutboxStatus, 'PROCESSING'>;
    deliveryResult: ContractEmailDeliveryResult;
    nextAttemptAt?: Date;
    sentAt?: Date;
  }, session?: import('mongoose').ClientSession): Promise<boolean>;
}

export const CONTRACT_NOTIFICATION_EMAIL_OUTBOX_REPOSITORY = Symbol('CONTRACT_NOTIFICATION_EMAIL_OUTBOX_REPOSITORY');
