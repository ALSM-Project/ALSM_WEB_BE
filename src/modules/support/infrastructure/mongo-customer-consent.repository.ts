import { ConflictException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ClientSession, Connection, Model } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  hasUnknownTransactionCommitResult,
  requireActiveTransaction,
} from '../../../shared/database/mongo-transaction-runner';
import type { AuditRepository } from '../../audit/domain/audit.repository';
import { CustomerConsentEntity } from '../domain/customer-consent.entity';
import type {
  CustomerConsentAudit,
  CustomerConsentRepository,
  CustomerConsentWriteOutcome,
} from '../domain/customer-consent.repository';
import type { CustomerConsentProps } from '../domain/customer-consent.types';
import { consentDataCopy } from '../domain/customer-consent.validation';
import {
  customerConsentFromSnapshot,
  customerConsentScope,
  customerConsentToSnapshot,
} from './customer-consent.mapper';
import {
  CUSTOMER_CONSENT_SOURCE_INDEX,
  CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
  CustomerConsentSnapshot,
} from './customer-consent.schema';

export type CustomerConsentAuditFactory = (
  session: ClientSession,
  connection: Connection,
) => AuditRepository;
class ConsentWriteConflict extends Error {}

/** Unregistered E2 adapter. Persistence is never verification or Ticket/Owner fencing. */
export class MongoCustomerConsentRepository implements CustomerConsentRepository {
  private readonly logger = new Logger(MongoCustomerConsentRepository.name);
  constructor(
    private readonly model: Model<CustomerConsentSnapshot>,
    private readonly audit: CustomerConsentAuditFactory,
  ) {
    if (typeof audit !== 'function')
      throw new Error('A transaction-bound audit factory is required');
  }

  async findById(
    consentId: string,
    organizationId: string,
    ticketId: string,
  ): Promise<CustomerConsentEntity | null> {
    const snapshot = await this.model
      .findOne(customerConsentScope(consentId, organizationId, ticketId))
      .lean()
      .exec();
    if (!snapshot) return null;
    const entity = this.read(snapshot),
      p = entity.toProps();
    return p.consentId === consentId &&
      p.organizationId === organizationId &&
      p.ticketId === ticketId
      ? entity
      : null;
  }

  async create(
    consent: CustomerConsentEntity,
    audit: CustomerConsentAudit,
  ): Promise<CustomerConsentWriteOutcome> {
    const snapshot = customerConsentToSnapshot(consent),
      p = customerConsentFromSnapshot(snapshot).toProps();
    if (p.state !== 'PENDING_VERIFICATION' || p.revision !== 0) this.rejected();
    const attribution = this.attribution(p, audit, null);
    await this.requireIndex();
    return this.atomic(
      async (session) => {
        const result = await this.collection().insertOne(snapshot, { session });
        if (result.acknowledged !== true || result.insertedId !== p.consentId)
          throw new UnconfirmedConsentWrite();
        await this.audit(session, this.model.db).append(attribution);
      },
      p,
      null,
    );
  }

  async save(
    consent: CustomerConsentEntity,
    expectedRevision: number,
    audit: CustomerConsentAudit,
  ): Promise<CustomerConsentWriteOutcome> {
    const snapshot = customerConsentToSnapshot(consent),
      p = customerConsentFromSnapshot(snapshot).toProps();
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      p.revision !== expectedRevision + 1 ||
      !['DECLINED', 'INVALIDATED'].includes(p.state)
    )
      this.rejected();
    const attribution = this.attribution(p, audit, expectedRevision);
    await this.requireIndex();
    return this.atomic(
      async (session) => {
        const scope = {
          ...customerConsentScope(p.consentId, p.organizationId, p.ticketId),
          episodeId: p.episodeId,
        };
        const previous = await this.model.findOne(scope).session(session).lean().exec();
        if (!previous) throw new ConsentWriteConflict();
        const entity = this.read(previous),
          before = entity.toProps();
        if (before.revision !== expectedRevision) throw new ConsentWriteConflict();
        const event = p.history[p.history.length - 1];
        let replayed: CustomerConsentEntity;
        try {
          replayed = entity.transition({
            action: p.state === 'DECLINED' ? 'DECLINE' : 'INVALIDATE',
            actorUserId: event.actorUserId,
            source: event.source,
            now: event.at,
            reason: event.reason,
          });
        } catch {
          this.rejected();
        }
        // Includes all immutable bindings and every prior event, not just revision arithmetic.
        if (!isDeepStrictEqual(replayed.toProps(), p)) this.rejected();
        const result = await this.collection().updateOne(
          { ...scope, revision: expectedRevision, state: 'PENDING_VERIFICATION' },
          {
            $set: {
              state: snapshot.state,
              revision: snapshot.revision,
              updatedAt: snapshot.updatedAt,
              updatedByUserId: snapshot.updatedByUserId,
              history: snapshot.history,
            },
          },
          { session, upsert: false },
        );
        if (result.acknowledged !== true) throw new UnconfirmedConsentWrite();
        if (result.matchedCount === 0 && result.modifiedCount === 0)
          throw new ConsentWriteConflict();
        if (result.matchedCount !== 1 || result.modifiedCount !== 1)
          throw new UnconfirmedConsentWrite();
        await this.audit(session, this.model.db).append(attribution);
      },
      p,
      expectedRevision,
    );
  }

  private attribution(
    p: CustomerConsentProps,
    input: CustomerConsentAudit,
    expectedRevision: number | null,
  ): CustomerConsentAudit {
    const event = p.history[p.history.length - 1];
    const expected: CustomerConsentAudit = {
      actorUserId: p.updatedByUserId,
      organizationId: p.organizationId,
      action: `CUSTOMER_CONSENT_${p.state === 'PENDING_VERIFICATION' ? 'REQUESTED' : p.state}`,
      resourceType: 'CUSTOMER_CONSENT',
      resourceId: p.consentId,
      metadata: {
        ticketId: p.ticketId,
        episodeId: p.episodeId,
        revision: String(p.revision),
        ...(expectedRevision === null ? {} : { expectedRevision: String(expectedRevision) }),
        state: p.state,
        sourceAuthorityId: event.source.authorityId,
        sourceEventId: event.source.evidenceId,
      },
    };
    let captured;
    try {
      captured = consentDataCopy(input);
    } catch {
      this.rejected();
    }
    if (!isDeepStrictEqual(captured, expected)) this.rejected();
    return captured;
  }
  private read(snapshot: unknown): CustomerConsentEntity {
    try {
      return customerConsentFromSnapshot(snapshot);
    } catch {
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_CONSENT_SNAPSHOT_INVALID',
        message: 'Stored Customer Consent is invalid',
      });
    }
  }
  private collection() {
    return this.model.db.collection<CustomerConsentSnapshot>(this.model.collection.name);
  }

  private async requireIndex() {
    let ready = false;
    try {
      ready = (await this.collection().indexes()).some(
        (index) =>
          index.name === CUSTOMER_CONSENT_SOURCE_INDEX_NAME &&
          index.unique === true &&
          !index.sparse &&
          !index.partialFilterExpression &&
          (!index.collation || index.collation.locale === 'simple') &&
          isDeepStrictEqual(index.key, CUSTOMER_CONSENT_SOURCE_INDEX),
      );
    } catch {
      /* Missing/unverifiable infrastructure cannot permit an unprotected write. */
    }
    if (!ready)
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_CONSENT_INDEX_REQUIRED',
        message: 'The required Consent source-event unique index is unavailable',
      });
  }

  private async atomic(
    work: (session: ClientSession) => Promise<void>,
    p: CustomerConsentProps,
    expectedRevision: number | null,
  ): Promise<CustomerConsentWriteOutcome> {
    const connection = this.model.db;
    const hello = await connection.db?.admin().command({ hello: 1 });
    if (!hello?.setName && hello?.msg !== 'isdbgrid')
      throw new ServiceUnavailableException({
        code: 'MONGO_TRANSACTIONS_REQUIRED',
        message: 'Consent mutations require transaction-capable MongoDB',
      });
    const session = await connection.startSession();
    let commitStarted = false;
    try {
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
        maxCommitTimeMS: 10000,
      });
      requireActiveTransaction(session);
      await work(session);
      commitStarted = true;
      await session.commitTransaction();
      return 'CONFIRMED';
    } catch (error) {
      if (!commitStarted && session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {
          this.logger.error('Consent transaction abort failed; original outcome retained');
        }
      }
      // Both-label/code-50 commit errors must never restart business work.
      if (
        commitStarted ||
        hasUnknownTransactionCommitResult(error) ||
        error instanceof UnconfirmedConsentWrite
      )
        return 'UNCONFIRMED';
      const code = (error as { code?: unknown } | null)?.code;
      if (error instanceof ConsentWriteConflict || code === 11000 || code === 112)
        return 'CONFLICT';
      if (error instanceof ConflictException || error instanceof ServiceUnavailableException)
        throw error;
      throw new ServiceUnavailableException(
        {
          code: 'ATOMIC_MUTATION_ABORTED',
          message: 'Consent state and audit were not committed',
          details: [
            {
              consentId: p.consentId,
              organizationId: p.organizationId,
              ticketId: p.ticketId,
              episodeId: p.episodeId,
              revision: p.revision,
              expectedRevision,
              mutationCommitted: false,
              retrySafe: false,
            },
          ],
        },
        { cause: error },
      );
    } finally {
      try {
        await session.endSession();
      } catch {
        this.logger.error('Consent session cleanup failed; established outcome retained');
      }
    }
  }
  private rejected(): never {
    throw new ConflictException({
      code: 'CUSTOMER_CONSENT_WRITE_REJECTED',
      message: 'Consent mutation or audit attribution is invalid',
    });
  }
}

class UnconfirmedConsentWrite extends Error {}
