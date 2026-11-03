import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { DiagnosticReadTransaction } from '../../../shared/application/diagnostic-read.port';
import { SupportInspection } from '../application/support-inspection.port';
import { SupportContextScope } from '../domain/support-context.repository';
import { SUPPORT_CONTEXT_MODEL, SupportContextSnapshot } from './support-context.schema';
import { supportContextFromSnapshot } from './support-context.mapper';

/** Primary majority reads only. No activity, audit append, lifecycle repair or retry. */
@Injectable()
export class MongoSupportInspection implements SupportInspection {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SUPPORT_CONTEXT_MODEL) private readonly contexts: Model<SupportContextSnapshot>,
  ) {}
  private filter(scope: Omit<SupportContextScope, 'id'>) {
    return {
      actorUserId: new Types.ObjectId(scope.actorUserId),
      originalSessionId: new Types.ObjectId(scope.originalSessionId),
      organizationId: new Types.ObjectId(scope.organizationId),
    };
  }
  async scoped(scope: SupportContextScope) {
    const row = await this.contexts
      .findOne({ ...this.filter(scope), _id: scope.id })
      .read('primary')
      .readConcern('majority')
      .maxTimeMS(2000)
      .lean()
      .exec();
    return row ? supportContextFromSnapshot(row) : null;
  }
  async latest(scope: Omit<SupportContextScope, 'id'>) {
    // UUID ordering is not creation ordering: contexts can share a millisecond.
    // Prefer the unique live origin row over terminal history with equal times.
    const active = await this.contexts
      .find({ ...this.filter(scope), state: 'ACTIVE' })
      .limit(2)
      .read('primary')
      .readConcern('majority')
      .maxTimeMS(2000)
      .lean()
      .exec();
    if (active.length > 1)
      throw new ServiceUnavailableException({ code: 'SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE' });
    if (active[0]) return supportContextFromSnapshot(active[0]);
    const rows = await this.contexts
      .find({ ...this.filter(scope), state: { $ne: 'ACTIVE' } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(2)
      .read('primary')
      .readConcern('majority')
      .maxTimeMS(2000)
      .lean()
      .exec();
    if (rows.length > 1 && rows[0].createdAt.getTime() === rows[1].createdAt.getTime()) return null;
    return rows[0] ? supportContextFromSnapshot(rows[0]) : null;
  }
  async snapshot<T>(work: (transaction: DiagnosticReadTransaction) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      session.startTransaction({ readConcern: { level: 'snapshot' }, readPreference: 'primary' });
      return await work({ session, connection: this.connection });
    } finally {
      // This transaction has no writes. It is deliberately never committed/replayed.
      try {
        if (session.inTransaction()) await session.abortTransaction();
      } finally {
        await session.endSession();
      }
    }
  }
}
