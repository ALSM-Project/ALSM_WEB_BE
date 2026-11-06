import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CONTRACT_AGGREGATE_REPOSITORY,
  type ContractAggregateRepository,
  type ContractLifecycleStatus,
} from '../domain/contract-aggregate.types';
import {
  CONTRACT_SIGNING_PROVIDER,
  type ContractSigningProviderPort,
} from '../domain/contract-signing-provider.port';
import {
  CONTRACT_AGGREGATE_UNIT_OF_WORK,
  type ContractAggregateUnitOfWork,
} from '../application/contract-aggregate-unit-of-work.port';
import { ContractAggregate, type ContractAggregateDocument } from './contract-aggregate.schema';

@Injectable()
export class ContractSigningReconciliationJob {
  private readonly logger = new Logger(ContractSigningReconciliationJob.name);

  constructor(
    @InjectModel(ContractAggregate.name)
    private readonly contractModel: Model<ContractAggregateDocument>,
    @Inject(CONTRACT_SIGNING_PROVIDER)
    private readonly provider: ContractSigningProviderPort,
    @Inject(CONTRACT_AGGREGATE_REPOSITORY)
    private readonly contractsRead: ContractAggregateRepository,
    @Inject(CONTRACT_AGGREGATE_UNIT_OF_WORK)
    private readonly unitOfWork: ContractAggregateUnitOfWork,
  ) {}

  /**
   * Reconciles status for all active envelopes with the provider.
   * Discovers and repairs any status drift caused by missed webhooks.
   */
  async reconcileActiveEnvelopes(): Promise<{ checked: number; reconciled: number }> {
    const readiness = this.provider.getReadiness();
    if (!readiness.configured || !readiness.capabilities.queryEnvelope) {
      return { checked: 0, reconciled: 0 };
    }

    const activeContracts = await this.contractModel
      .find({
        lifecycleStatus: {
          $in: [
            'READY_FOR_SIGNATURE',
            'SENT_TO_CUSTOMER',
            'CUSTOMER_VIEWED',
            'CUSTOMER_SIGNING_IN_PROGRESS',
            'CUSTOMER_PARTIALLY_SIGNED',
          ],
        },
        'providerSigningSession.providerEnvelopeReference': { $exists: true },
      })
      .exec();

    let reconciled = 0;

    for (const doc of activeContracts) {
      const ref = doc.providerSigningSession?.providerEnvelopeReference;
      if (!ref) continue;

      try {
        const providerStatus = await this.provider.getEnvelopeStatus(ref);
        const targetStatus = this.mapProviderStatusToLifecycle(providerStatus);

        if (targetStatus && targetStatus !== doc.lifecycleStatus) {
          this.logger.log(
            `Status drift detected for contract ${doc._id} (envelope ${ref}): DB=${doc.lifecycleStatus} vs Provider=${providerStatus}`,
          );

          const isConfirmed = providerStatus === 'COMPLETED';

          await this.unitOfWork.run(async ({ contracts, audit, notifications }) => {
            await contracts.updateProviderSigningStatus({
              contractId: String(doc._id),
              providerEnvelopeReference: ref,
              status: targetStatus,
              providerCompletionStatus: isConfirmed ? 'CONFIRMED' : undefined,
              eventReference: `reconcile-${Date.now()}`,
              now: new Date(),
            });

            await audit.appendOnce(`contract-reconciliation:${doc._id}:${Date.now()}`, {
              actorUserId: 'system:contract-reconciliation',
              organizationId: String(doc.organizationId),
              action: 'CONTRACT_SIGNING_RECONCILED',
              resourceType: 'CONTRACT',
              resourceId: String(doc._id),
              metadata: {
                previousStatus: doc.lifecycleStatus,
                newStatus: targetStatus,
                providerStatus,
                providerEnvelopeReference: ref,
              },
            });

            if (isConfirmed && doc.customerUserId) {
              await notifications.create({
                recipientUserIds: [String(doc.customerUserId), String(doc.createdByUserId)],
                type: 'CONTRACT_SIGNING_COMPLETED',
                title: 'Hợp đồng đã hoàn thành đối soát ký',
                message: `Hợp đồng ${doc.contractNumber} đã được ký hoàn tất (xác nhận qua đối soát).`,
                eventKey: `contract-reconcile-complete:${doc._id}`,
                resourceType: 'CONTRACT',
                resourceId: String(doc._id),
                link: '/contracts',
              });
            }
          }, `reconcile:${doc._id}`);

          reconciled++;
        }
      } catch (error) {
        this.logger.warn(`Failed to reconcile envelope ${ref}: ${String(error)}`);
      }
    }

    return { checked: activeContracts.length, reconciled };
  }

  private mapProviderStatusToLifecycle(
    status: string,
  ): ContractLifecycleStatus | null {
    switch (status) {
      case 'SENT':
        return 'SENT_TO_CUSTOMER';
      case 'IN_PROGRESS':
        return 'CUSTOMER_SIGNING_IN_PROGRESS';
      case 'COMPLETED':
        return 'PROVIDER_COMPLETED_EVIDENCE_PENDING';
      case 'DECLINED':
        return 'REJECTED';
      case 'CANCELLED':
        return 'CANCELLED';
      case 'EXPIRED':
        return 'EXPIRED';
      default:
        return null;
    }
  }
}

