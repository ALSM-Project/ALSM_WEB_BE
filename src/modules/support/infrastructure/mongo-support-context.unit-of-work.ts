import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import {
  hasUnknownTransactionCommitResult,
  MongoTransactionRunner,
} from '../../../shared/database/mongo-transaction-runner';
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
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(SUPPORT_CONTEXT_MODEL) private readonly contexts: Model<SupportContextSnapshot>,
    @Inject(TRANSACTIONAL_AUDIT_FACTORY) private readonly audit: TransactionalAuditFactory,
  ) {}

  async run<T>(
    resourceId: string,
    work: (ports: SupportContextParticipants) => Promise<T>,
  ): Promise<T> {
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
      return await new MongoTransactionRunner(this.connection).run(async (session) => {
        try {
          return await work({
            contexts: new MongoSupportContextRepository(this.contexts, session, this.connection),
            audit: this.audit.bind({ session, connection: this.connection }),
          });
        } catch (error) {
          if (error instanceof SupportContextError) mapSupportContextError(error);
          // Do not replace mixed unknown-result errors with an apparently definite conflict.
          if (
            !hasUnknownTransactionCommitResult(error) &&
            (error as { code?: number })?.code === 11000
          )
            throw new ConflictException({
              code: 'SUPPORT_CONTEXT_CONFLICT',
              message: 'A Support context already exists; reconcile before retrying',
            });
          throw error;
        }
      }, resourceId);
    } catch (error) {
      const response = error instanceof HttpException ? error.getResponse() : undefined;
      const code =
        typeof response === 'object' && response !== null && 'code' in response
          ? response.code
          : undefined;
      if (code === 'TEAM_MUTATION_OUTCOME_UNCONFIRMED' || hasUnknownTransactionCommitResult(error))
        throw new ServiceUnavailableException({
          code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
          message: 'Commit outcome is unknown; reconcile this context before retrying',
          details: [{ contextId: resourceId, mutationCommitted: 'unknown', retrySafe: false }],
        });
      if (error instanceof HttpException && code !== 'ATOMIC_MUTATION_ABORTED') throw error;
      throw new ServiceUnavailableException({
        code: 'SUPPORT_CONTEXT_PERSISTENCE_UNAVAILABLE',
        message: 'Support context and audit could not be committed',
        details: [{ contextId: resourceId, mutationCommitted: false, retrySafe: false }],
      });
    }
  }
}
