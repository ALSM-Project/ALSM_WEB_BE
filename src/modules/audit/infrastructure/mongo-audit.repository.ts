import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { Injectable, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditLog } from './audit-log.schema';
import { AuditRepository, IdempotentAuditRepository, AuditRecord } from '../domain/audit.repository';
import { requestIpStorage } from '../../../shared/logging/request-ip.storage';
@Injectable()
export class MongoAuditRepository implements IdempotentAuditRepository, OnApplicationBootstrap {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.model.init();
    const indexes = await this.model.collection.indexes();
    const eventKeyIndex = indexes.find((index) => index.name === 'audit_event_key_unique');
    if (
      !eventKeyIndex?.unique ||
      JSON.stringify(eventKeyIndex.key) !== JSON.stringify({ eventKey: 1 })
    ) {
      throw new ServiceUnavailableException({
        code: 'AUDIT_EVENT_INDEX_UNAVAILABLE',
        message: 'Audit event idempotency index is unavailable; invitation mutations cannot start safely.',
      });
    }
  }
  private session?: ClientSession;
  private transaction?: object;
  private assertSession(): void {
    if (this.session) {
      requireActiveTransaction(this.session);
      if (this.transaction !== this.session.transaction)
        throw new Error('Stale transaction participant');
    }
  }
  inTransaction(session: ClientSession, connection: Connection): MongoAuditRepository {
    requireActiveTransaction(session);
    if (this.model.db !== connection) throw new Error('Transaction connection mismatch');
    const repository = new MongoAuditRepository(this.model);
    repository.session = session;
    repository.transaction = session.transaction;
    return repository;
  }
  async append(input: Parameters<AuditRepository['append']>[0]): Promise<void> {
    this.assertSession();
    if (this.session) requireActiveTransaction(this.session);
    await this.model.create(
      [
        {
          ...input,
          actorUserId: input.actorUserId ? new Types.ObjectId(input.actorUserId) : undefined,
          organizationId: input.organizationId
            ? new Types.ObjectId(input.organizationId)
            : undefined,
          ipAddress: requestIpStorage.getStore() || '127.0.0.1',
        },
      ],
      { session: this.session },
    );
  }

  async appendOnce(
    eventKey: string,
    input: Parameters<AuditRepository['append']>[0],
    legacy?: { createdAtAfter?: Date },
  ): Promise<void> {
    this.assertSession();
    if (!this.session) throw new Error('Idempotent audit writes require a transaction');
    requireActiveTransaction(this.session);
    const existing = await this.model
      .findOne({ eventKey })
      .select('_id')
      .session(this.session)
      .exec();
    if (existing) return;
    const legacySingleEventActions = new Set([
      'CONTRACT_INVITATION_CREATED',
      'CONTRACT_INVITATION_EXPIRED',
      'CONTRACT_INVITATION_REVOKED',
      'CONTRACT_INVITATION_ACCEPTED',
      'CONTRACT_INVITATION_DELIVERY_RECORDED',
      'PROSPECT_ACCOUNT_CREATED',
      'PROSPECT_EMAIL_VERIFICATION_DELIVERY_RECORDED',
    ]);
    const legacyFilter = input.resourceId && legacySingleEventActions.has(input.action)
      ? {
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        eventKey: { $exists: false },
      }
      : input.resourceId && input.action === 'CONTRACT_INVITATION_RESENT' && legacy?.createdAtAfter
        ? {
            action: input.action,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            eventKey: { $exists: false },
            createdAt: { $gte: legacy.createdAtAfter },
          }
        : null;
    if (legacyFilter && await this.model.exists(legacyFilter).session(this.session)) {
      return;
    }
    await this.model.create(
      [
        {
          ...input,
          eventKey,
          actorUserId: input.actorUserId ? new Types.ObjectId(input.actorUserId) : undefined,
          organizationId: input.organizationId
            ? new Types.ObjectId(input.organizationId)
            : undefined,
          ipAddress: requestIpStorage.getStore() || '127.0.0.1',
        },
      ],
      { session: this.session },
    );
  }

  async findByResource(resourceType: string, resourceId: string): Promise<AuditRecord[]> {
    const docs = await this.model
      .find({ resourceType, resourceId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec();
    return docs.map((doc: any) => ({
      id: doc._id?.toString() || '',
      actorUserId: doc.actorUserId ? doc.actorUserId.toString() : undefined,
      organizationId: doc.organizationId ? doc.organizationId.toString() : undefined,
      action: doc.action,
      resourceType: doc.resourceType,
      resourceId: doc.resourceId,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
    }));
  }
}
