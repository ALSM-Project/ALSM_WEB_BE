import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { hasUnknownTransactionCommitResult } from '../../../shared/database/mongo-transaction-runner';
import {
  TRANSACTIONAL_AUDIT_FACTORY,
  TransactionalAuditFactory,
} from '../../audit/domain/transactional-audit.port';
import {
  SupportContextParticipants,
  SupportContextUnitOfWork,
} from '../application/support-context.ports';
import { mapSupportContextError } from '../application/support-context.errors';
import { SupportContextError } from '../domain/support-context.entity';
import { MongoSupportContextRepository } from './mongo-support-context.repository';
import {
  SUPPORT_ACTIVE_ORIGIN_INDEX,
  SUPPORT_CONTEXT_MODEL,
  SupportContextSnapshot,
} from './support-context.schema';

@Injectable()
export class MongoSupportContextUnitOfWork implements SupportContextUnitOfWork {
  private readonly logger = new Logger(MongoSupportContextUnitOfWork.name);
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SUPPORT_CONTEXT_MODEL) private readonly contexts: Model<SupportContextSnapshot>,
    @Inject(TRANSACTIONAL_AUDIT_FACTORY) private readonly audit: TransactionalAuditFactory,
  ) {}

  async run<T>(
    resourceId: string,
    work: (ports: SupportContextParticipants) => Promise<T>,
  ): Promise<T> {
    // Schedule same-context calls locally rather than replaying their callbacks.
    // Across instances, MongoDB uniqueness/CAS still governs conflicting writes.
    const previous = this.pending.get(resourceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.pending.set(resourceId, tail);
    await previous;
    try {
      return await this.runOnce(resourceId, work);
    } finally {
      release();
      if (this.pending.get(resourceId) === tail) this.pending.delete(resourceId);
    }
  }

  private async runOnce<T>(
    resourceId: string,
    work: (ports: SupportContextParticipants) => Promise<T>,
  ): Promise<T> {
    let session: ClientSession | undefined;
    let commitStarted = false;
    try {
      const indexes = await this.contexts.collection.listIndexes().toArray();
      if (
        !indexes.some(
          (index) =>
            index.name === SUPPORT_ACTIVE_ORIGIN_INDEX &&
            index.unique === true &&
            JSON.stringify(index.key) ===
              JSON.stringify({ actorUserId: 1, originalSessionId: 1 }) &&
            JSON.stringify(index.partialFilterExpression) === JSON.stringify({ state: 'ACTIVE' }) &&
            !index.collation,
        )
      )
        throw new ServiceUnavailableException({
          code: 'SUPPORT_CONTEXT_INDEX_UNAVAILABLE',
          message: 'Required Support context uniqueness index is unavailable',
        });
      const hello = await this.connection.db?.admin().command({ hello: 1 });
      if (!hello?.setName && hello?.msg !== 'isdbgrid')
        throw new ServiceUnavailableException({
          code: 'MONGO_TRANSACTIONS_REQUIRED',
          message: 'This mutation requires a transaction-capable MongoDB deployment',
          details: [{ contextId: resourceId, mutationCommitted: false, retrySafe: false }],
        });
      session = await this.connection.startSession();
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
        maxCommitTimeMS: 10000,
      });
      const result = await work({
        contexts: new MongoSupportContextRepository(this.contexts, session, this.connection),
        audit: this.audit.bind({ session, connection: this.connection }),
        readTransaction: { session, connection: this.connection },
      });
      // Core API only: the installed driver may retry this same commit command,
      // but no convenience API can restart the business callback after uncertainty.
      commitStarted = true;
      await session.commitTransaction();
      return result;
    } catch (error) {
      if (session && !commitStarted) {
        try {
          if (session.inTransaction()) await session.abortTransaction();
        } catch {
          this.logger.error(
            'Support transaction abort cleanup failed; the primary outcome is unchanged',
          );
        }
      }
      // A rejected commit can have reached the server even without an error label.
      // Never turn a commit-phase error into a definite rollback/conflict.
      if (commitStarted || hasUnknownTransactionCommitResult(error))
        throw new ServiceUnavailableException({
          code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
          message: 'Commit outcome is unknown; reconcile this context before retrying',
          details: [{ contextId: resourceId, mutationCommitted: 'unknown', retrySafe: false }],
        });
      if (error instanceof SupportContextError) mapSupportContextError(error);
      if (error instanceof HttpException) throw error;
      const candidate = error as {
        code?: number;
        hasErrorLabel?: (label: string) => boolean;
      } | null;
      if (
        candidate?.code === 11000 ||
        (typeof candidate?.hasErrorLabel === 'function' &&
          candidate.hasErrorLabel('TransientTransactionError'))
      )
        throw new ConflictException({
          code: 'SUPPORT_CONTEXT_CONFLICT',
          message: 'Support context transaction was aborted; reconcile before a new request',
          details: [{ contextId: resourceId, mutationCommitted: false, retrySafe: false }],
        });
      throw new ServiceUnavailableException({
        code: 'SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE',
        message: 'Support context and audit could not be committed',
        details: [{ contextId: resourceId, mutationCommitted: false, retrySafe: false }],
      });
    } finally {
      if (session) {
        try {
          await session.endSession();
        } catch {
          this.logger.error(
            'Support transaction session cleanup failed; the primary outcome is unchanged',
          );
        }
      }
    }
  }
}
