import { ConflictException } from '@nestjs/common';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { requireActiveTransaction } from '../../../shared/database/mongo-transaction-runner';
import { SupportContextEntity } from '../domain/support-context.entity';
import {
  SupportContextRepository,
  SupportContextScope,
} from '../domain/support-context.repository';
import { supportContextFromSnapshot, supportContextToSnapshot } from './support-context.mapper';
import { SupportContextSnapshot } from './support-context.schema';

/** A participant is created per transaction callback, never reused after a retry/commit. */
export class MongoSupportContextRepository implements SupportContextRepository {
  private readonly transaction: object;

  constructor(
    private readonly model: Model<SupportContextSnapshot>,
    private readonly session: ClientSession,
    connection: Connection,
  ) {
    requireActiveTransaction(session);
    if (model.db !== connection) throw new Error('Transaction connection mismatch');
    this.transaction = session.transaction;
  }

  async activeForOrigin(
    actorUserId: string,
    originalSessionId: string,
  ): Promise<SupportContextEntity | null> {
    this.assertTransaction();
    const rows = await this.model
      .find({
        actorUserId: new Types.ObjectId(actorUserId),
        originalSessionId: new Types.ObjectId(originalSessionId),
        state: 'ACTIVE',
      })
      .limit(2)
      .session(this.session)
      .lean()
      .exec();
    if (rows.length > 1) throw new Error('Ambiguous active Support contexts');
    return rows[0] ? supportContextFromSnapshot(rows[0]) : null;
  }

  async scoped(scope: SupportContextScope): Promise<SupportContextEntity | null> {
    this.assertTransaction();
    const row = await this.model
      .findOne({
        _id: scope.id,
        organizationId: new Types.ObjectId(scope.organizationId),
        actorUserId: new Types.ObjectId(scope.actorUserId),
        originalSessionId: new Types.ObjectId(scope.originalSessionId),
      })
      .session(this.session)
      .lean()
      .exec();
    return row ? supportContextFromSnapshot(row) : null;
  }

  async create(context: SupportContextEntity): Promise<void> {
    this.assertTransaction();
    await this.model.create([supportContextToSnapshot(context)], { session: this.session });
  }

  async save(context: SupportContextEntity, expectedRevision: number): Promise<void> {
    this.assertTransaction();
    const props = context.toProps();
    if (props.revision !== expectedRevision + 1) throw new Error('Invalid context revision');
    const result = await this.model
      .updateOne(
        {
          _id: props.id,
          organizationId: new Types.ObjectId(props.organizationId),
          actorUserId: new Types.ObjectId(props.actorUserId),
          originalSessionId: new Types.ObjectId(props.originalSessionId),
          state: 'ACTIVE',
          revision: expectedRevision,
        },
        {
          $set: {
            state: props.state,
            lastActivityAt: props.lastActivityAt,
            endedAt: props.endedAt,
            revision: props.revision,
          },
        },
        { session: this.session },
      )
      .exec();
    if (!result.acknowledged || result.matchedCount !== 1 || result.modifiedCount !== 1)
      throw new ConflictException({
        code: 'SUPPORT_CONTEXT_CONFLICT',
        message: 'Support context changed; reconcile before retrying',
      });
  }

  private assertTransaction(): void {
    requireActiveTransaction(this.session);
    if (this.transaction !== this.session.transaction)
      throw new Error('Stale transaction participant');
  }
}
