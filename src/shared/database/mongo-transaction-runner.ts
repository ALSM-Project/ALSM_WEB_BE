import { HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';

/** Infrastructure only. No nontransactional fallback, external effects or security admission. */
@Injectable()
export class MongoTransactionRunner {
  private readonly logger = new Logger(MongoTransactionRunner.name);
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async run<T>(work: (session: ClientSession) => Promise<T>, resourceId: string): Promise<T> {
    const hello = await this.connection.db?.admin().command({ hello: 1 });
    if (!hello?.setName && hello?.msg !== 'isdbgrid') {
      throw new ServiceUnavailableException({
        code: 'MONGO_TRANSACTIONS_REQUIRED',
        message: 'This mutation requires a transaction-capable MongoDB deployment',
        details: [{ resourceId, mutationCommitted: false, retrySafe: false }],
      });
    }
    const session = await this.connection.startSession();
    try {
      // One bounded duplicate-key retry starts a NEW transaction and resolves a
      // concurrent stable-ID insert. Never query a transaction aborted by E11000.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await session.withTransaction(
            async () => {
              try {
                return await work(session);
              } catch (error) {
                // Do not let a mixed transient label trigger a driver callback
                // retry when the business operation's outcome is uncertain.
                if (hasUnknownTransactionCommitResult(error)) throw this.unconfirmed(resourceId);
                throw error;
              }
            },
            {
              readConcern: { level: 'snapshot' },
              writeConcern: { w: 'majority' },
              readPreference: 'primary',
              maxCommitTimeMS: 10000,
            },
          );
        } catch (error) {
          if (
            attempt === 0 &&
            (error as { code?: number })?.code === 11000 &&
            !hasUnknownTransactionCommitResult(error)
          )
            continue;
          throw error;
        }
      }
      throw new Error('Transaction outcome unavailable');
    } catch (error) {
      if (hasUnknownTransactionCommitResult(error)) throw this.unconfirmed(resourceId);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        code: 'ATOMIC_MUTATION_ABORTED',
        message: 'Business state and audit were not committed; reconcile before retrying',
        details: [{ resourceId, mutationCommitted: false, retrySafe: false }],
      });
    } finally {
      try {
        await session.endSession();
      } catch {
        this.logger.error(
          'Transaction session cleanup failed; the established mutation outcome is unchanged',
        );
      }
    }
  }

  private unconfirmed(resourceId: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
      message: 'Commit outcome is unknown; reconcile by the original resource ID before retrying',
      details: [{ resourceId, mutationCommitted: 'unknown', retrySafe: false }],
    });
  }
}

export function hasUnknownTransactionCommitResult(error: unknown): boolean {
  const candidate = error as { hasErrorLabel?: (label: string) => boolean } | null;
  return (
    typeof candidate?.hasErrorLabel === 'function' &&
    candidate.hasErrorLabel('UnknownTransactionCommitResult') === true
  );
}

export function requireActiveTransaction(session: ClientSession): void {
  if (session.hasEnded || !session.explicit || !session.inTransaction())
    throw new Error('An active explicit transaction is required');
}
