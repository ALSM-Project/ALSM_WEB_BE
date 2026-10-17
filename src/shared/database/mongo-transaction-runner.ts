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
          return await session.withTransaction(() => work(session), {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
            maxCommitTimeMS: 10000,
          });
        } catch (error) {
          if (attempt === 0 && (error as { code?: number })?.code === 11000) continue;
          throw error;
        }
      }
      throw new Error('Transaction outcome unavailable');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const unknown =
        (error as { hasErrorLabel?: (label: string) => boolean })?.hasErrorLabel?.(
          'UnknownTransactionCommitResult',
        ) === true;
      throw new ServiceUnavailableException({
        code: unknown ? 'TEAM_MUTATION_OUTCOME_UNCONFIRMED' : 'ATOMIC_MUTATION_ABORTED',
        message: unknown
          ? 'Commit outcome is unknown; reconcile by the original resource ID before retrying'
          : 'Business state and audit were not committed; reconcile before retrying',
        details: [{ resourceId, mutationCommitted: unknown ? 'unknown' : false, retrySafe: false }],
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
}

export function requireActiveTransaction(session: ClientSession): void {
  if (session.hasEnded || !session.explicit || !session.inTransaction())
    throw new Error('An active explicit transaction is required');
}
