import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EMAIL_PORT, EmailDeliveryStatus, EmailPort } from '../../auth/domain/email.port';
import { CONTRACT_AGGREGATE_UNIT_OF_WORK, ContractAggregateUnitOfWork } from '../application/contract-aggregate-unit-of-work.port';
import {
  CONTRACT_NOTIFICATION_EMAIL_OUTBOX_REPOSITORY,
  ContractEmailOutboxRecord,
  ContractNotificationEmailOutboxRepository,
} from '../domain/contract-notification-email-outbox.types';

const POLL_INTERVAL_MS = 5_000;
const LEASE_DURATION_MS = 5 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

@Injectable()
export class ContractNotificationEmailOutboxWorker implements OnModuleDestroy {
  private readonly logger = new Logger(ContractNotificationEmailOutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    @Inject(CONTRACT_NOTIFICATION_EMAIL_OUTBOX_REPOSITORY)
    private readonly outbox: ContractNotificationEmailOutboxRepository,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(CONTRACT_AGGREGATE_UNIT_OF_WORK) private readonly unitOfWork: ContractAggregateUnitOfWork,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.drain(), POLL_INTERVAL_MS);
    void this.drain();
    this.logger.log('Contract notification email outbox worker started.');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let index = 0; index < 20; index += 1) {
        const now = new Date();
        const row = await this.outbox.claimNext({
          now,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
        });
        if (!row) break;
        await this.deliver(row);
      }
    } catch {
      this.logger.error('Contract notification email outbox polling failed.');
    } finally {
      this.draining = false;
    }
  }

  private async deliver(row: ContractEmailOutboxRecord): Promise<void> {
    let result: EmailDeliveryStatus | void;
    let deliveryResult: 'SENT' | 'NOT_CONFIGURED' | 'UNCONFIRMED' | 'FAILED';
    try {
      result = await this.email.send({
        to: row.recipientEmail,
        subject: row.subject,
        text: row.text,
        html: row.html,
      });
      deliveryResult = result === 'SENT' ? 'SENT' : result === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNCONFIRMED';
    } catch {
      deliveryResult = 'FAILED';
    }

    const completedAt = new Date();
    const isSent = deliveryResult === 'SENT';
    const isUnconfigured = deliveryResult === 'NOT_CONFIGURED';
    const isTerminal = !isSent && !isUnconfigured && row.attempts >= row.maxAttempts;
    const status = isSent ? 'SENT' as const : isUnconfigured ? 'BLOCKED_CONFIGURATION' as const : isTerminal ? 'DEAD' as const : 'RETRY' as const;
    const delay = isUnconfigured ? 15 * 60_000 : Math.min(30_000 * (2 ** Math.max(0, row.attempts - 1)), MAX_BACKOFF_MS);
    try {
      await this.unitOfWork.run(async ({ emailOutbox, audit }) => {
        const settled = await emailOutbox.settle({
          id: row.id,
          leaseToken: row.leaseToken ?? '',
          status,
          deliveryResult,
          nextAttemptAt: isSent || isTerminal ? undefined : new Date(completedAt.getTime() + delay),
          sentAt: isSent ? completedAt : undefined,
        });
        if (!settled) return;
        await audit.appendOnce(
          `contract-email-outbox:${row.id}:attempt:${row.attempts}`,
          {
          actorUserId: row.actorUserId,
          organizationId: row.organizationId,
          action: 'CONTRACT_NOTIFICATION_EMAIL_DELIVERY_RECORDED',
          resourceType: 'CONTRACT',
          resourceId: row.contractId,
          metadata: {
            eventKey: row.eventKey,
            deliveryStatus: deliveryResult,
            outboxStatus: status,
            attempt: String(row.attempts),
          },
          },
        );
      }, `contract-email-outbox:${row.id}`);
    } catch {
      this.logger.error(`Contract email delivery outcome could not be settled for outbox item ${row.id}; its lease will expire for retry.`);
    }
  }
}
