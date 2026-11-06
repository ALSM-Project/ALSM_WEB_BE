import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONTRACT_AGGREGATE_REPOSITORY,
  type ContractAggregateRepository,
  type ContractLifecycleStatus,
} from '../domain/contract-aggregate.types';
import {
  CONTRACT_SIGNING_PROVIDER,
  type ContractSigningProviderPort,
  type VerifiedSigningProviderEvent,
} from '../domain/contract-signing-provider.port';
import {
  CONTRACT_AGGREGATE_UNIT_OF_WORK,
  type ContractAggregateUnitOfWork,
} from './contract-aggregate-unit-of-work.port';

@Injectable()
export class ContractSigningWebhookService {
  private readonly logger = new Logger(ContractSigningWebhookService.name);

  constructor(
    @Inject(CONTRACT_SIGNING_PROVIDER)
    private readonly provider: ContractSigningProviderPort,
    @Inject(CONTRACT_AGGREGATE_REPOSITORY)
    private readonly contractsRead: ContractAggregateRepository,
    @Inject(CONTRACT_AGGREGATE_UNIT_OF_WORK)
    private readonly unitOfWork: ContractAggregateUnitOfWork,
  ) {}

  /**
   * Verifies and processes raw webhook payload from signing provider.
   * Ensures constant-time auth check and idempotent status progression.
   */
  async handleCallback(input: {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<{ accepted: boolean; eventType?: string }> {
    const verifiedEvent = await this.provider.verifyWebhook(input);

    if (!verifiedEvent) {
      this.logger.warn('Rejected unverified signing provider webhook callback.');
      return { accepted: false };
    }

    const { providerEnvelopeReference, eventType, occurredAt } = verifiedEvent;

    const contract = await this.contractsRead.findByProviderEnvelopeReference(providerEnvelopeReference);
    if (!contract) {
      this.logger.warn(`Webhook received for unknown envelope reference: ${providerEnvelopeReference}`);
      return { accepted: true }; // Acknowledge to prevent provider retry floods
    }

    const newLifecycleStatus = this.mapEventToLifecycleStatus(eventType);

    await this.unitOfWork.run(async ({ contracts, audit, notifications }) => {
      const isConfirmed = eventType === 'ENVELOPE_COMPLETED';

      const updated = await contracts.updateProviderSigningStatus({
        contractId: contract.contract.id,
        providerEnvelopeReference,
        status: newLifecycleStatus,
        providerCompletionStatus: isConfirmed ? 'CONFIRMED' : undefined,
        eventReference: verifiedEvent.providerEventReference,
        now: occurredAt,
      });

      if (!updated) {
        this.logger.warn(`Could not update contract status for envelope ${providerEnvelopeReference}`);
        return;
      }

      const eventKey = `contract-signing-webhook:${contract.contract.id}:${verifiedEvent.providerEventReference}`;
      await audit.appendOnce(eventKey, {
        actorUserId: 'system:signing-provider-webhook',
        organizationId: contract.contract.organizationId,
        action: `CONTRACT_SIGNING_${eventType}`,
        resourceType: 'CONTRACT',
        resourceId: contract.contract.id,
        metadata: {
          providerEnvelopeReference,
          providerEventReference: verifiedEvent.providerEventReference,
          eventType,
          occurredAt: occurredAt.toISOString(),
          newLifecycleStatus,
        },
      });

      if (isConfirmed && contract.contract.customerUserId) {
        await notifications.create({
          recipientUserIds: [contract.contract.customerUserId, contract.contract.createdByUserId],
          type: 'CONTRACT_SIGNING_COMPLETED',
          title: 'Hợp đồng đã ký thành công',
          message: `Hợp đồng ${contract.contract.contractNumber} đã được ký hoàn tất bởi các bên.`,
          eventKey,
          resourceType: 'CONTRACT',
          resourceId: contract.contract.id,
          link: '/contracts',
        });
      }
    }, `signing-webhook:${providerEnvelopeReference}`);

    this.logger.log(
      `Successfully processed ${eventType} for envelope ${providerEnvelopeReference} -> ${newLifecycleStatus}`,
    );

    return { accepted: true, eventType };
  }

  private mapEventToLifecycleStatus(
    eventType: VerifiedSigningProviderEvent['eventType'],
  ): ContractLifecycleStatus {
    switch (eventType) {
      case 'ENVELOPE_SENT':
        return 'SENT_TO_CUSTOMER';
      case 'SIGNER_VIEWED':
        return 'CUSTOMER_VIEWED';
      case 'SIGNER_COMPLETED':
        return 'CUSTOMER_PARTIALLY_SIGNED';
      case 'ENVELOPE_COMPLETED':
        return 'PROVIDER_COMPLETED_EVIDENCE_PENDING';
      case 'SIGNER_DECLINED':
        return 'REJECTED';
      case 'ENVELOPE_CANCELLED':
        return 'CANCELLED';
      case 'ENVELOPE_EXPIRED':
        return 'EXPIRED';
      default:
        return 'CUSTOMER_SIGNING_IN_PROGRESS';
    }
  }
}

