import {
  ConflictException,
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientSession, Connection, Model } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  hasUnknownTransactionCommitResult,
  requireActiveTransaction,
} from '../../../shared/database/mongo-transaction-runner';
import { AuditRepository } from '../../audit/domain/audit.repository';
import { SupportTicketEntity } from '../domain/support-ticket.entity';
import { SupportTicketRepository } from '../domain/support-ticket.repository';
import {
  SUPPORT_TICKET_PAGE_MAX,
  SupportTicketListingPort,
} from '../domain/support-ticket-listing.port';
import { SupportTicketError, SupportTicketProps } from '../domain/support-ticket.types';
import {
  supportTicketFromSnapshot,
  supportTicketOrganizationScope,
  supportTicketScope,
  supportTicketToSnapshot,
} from './support-ticket.mapper';
import { SupportTicket } from './support-ticket.schema';

/** Composition must supply the existing audit adapter bound to the exact session/connection. */
export type SupportTicketAuditFactory = (
  session: ClientSession,
  connection: Connection,
) => AuditRepository;

export class MongoSupportTicketRepository
  implements SupportTicketRepository, SupportTicketListingPort
{
  private readonly logger = new Logger(MongoSupportTicketRepository.name);

  constructor(
    private readonly model: Model<SupportTicket>,
    private readonly audit: SupportTicketAuditFactory,
  ) {
    if (typeof audit !== 'function')
      throw new Error('A transaction-bound audit factory is required');
  }

  async findById(ticketId: string, organizationId: string): Promise<SupportTicketEntity | null> {
    const scope = supportTicketScope(ticketId, organizationId);
    const snapshot = await this.model.findOne(scope).lean().exec();
    if (!snapshot) return null;
    const ticket = this.read(snapshot);
    const props = ticket.toProps();
    return props.ticketId === ticketId && props.organizationId === organizationId ? ticket : null;
  }

  async list(
    organizationId: string,
    limit: number,
    afterTicketId?: string,
  ): Promise<SupportTicketEntity[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > SUPPORT_TICKET_PAGE_MAX)
      throw new Error('Invalid Support Ticket page bound');
    const scope = supportTicketOrganizationScope(organizationId);
    const after =
      afterTicketId === undefined
        ? undefined
        : supportTicketScope(afterTicketId, organizationId)._id;
    const snapshots = await this.model
      .find({
        ...scope,
        ...(after === undefined ? {} : { _id: { $gt: after } }),
      })
      .sort({ _id: 1 })
      .limit(limit + 1)
      .lean()
      .exec();
    return snapshots.map((snapshot) => this.read(snapshot));
  }

  async create(ticket: SupportTicketEntity): Promise<void> {
    const snapshot = supportTicketToSnapshot(ticket);
    const props = supportTicketFromSnapshot(snapshot).toProps();
    const initial = SupportTicketEntity.createNew({
      ticketId: props.ticketId,
      organizationId: props.organizationId,
      episodeId: props.episodeId,
      requesterUserId: props.requesterUserId,
      purposeId: props.purposeId,
      now: props.createdAt,
    }).toProps();
    if (!isDeepStrictEqual(initial, props)) this.conflict('SUPPORT_TICKET_INVALID_CREATION');
    await this.atomic(async (session) => {
      let result;
      try {
        // Native acknowledgement, domain-validated BSON: no casting/defaults or upsert.
        result = await this.collection().insertOne(snapshot, { session });
      } catch (error) {
        if (hasUnknownTransactionCommitResult(error)) this.unconfirmed(props, error);
        if ((error as { code?: number })?.code === 11000)
          this.conflict('SUPPORT_TICKET_ALREADY_EXISTS');
        throw error;
      }
      if (result.acknowledged !== true || result.insertedId !== snapshot._id)
        this.unconfirmed(props);
      await this.appendAudit(session, props, 'SUPPORT_TICKET_CREATED', props.requesterUserId);
    }, props);
  }

  async save(ticket: SupportTicketEntity, expectedRevision: number): Promise<boolean> {
    const snapshot = supportTicketToSnapshot(ticket);
    const next = supportTicketFromSnapshot(snapshot).toProps();
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      next.revision !== expectedRevision + 1
    ) {
      this.conflict('SUPPORT_TICKET_INVALID_TRANSITION');
    }
    return this.atomic(
      async (session) => {
        const scope = supportTicketScope(next.ticketId, next.organizationId);
        const previousSnapshot = await this.model.findOne(scope).session(session).lean().exec();
        if (!previousSnapshot) return false;
        const previous = this.read(previousSnapshot);
        const before = previous.toProps();
        if (before.revision !== expectedRevision) return false;
        if (
          before.requesterUserId !== next.requesterUserId ||
          before.purposeId !== next.purposeId ||
          before.createdAt.getTime() !== next.createdAt.getTime()
        )
          this.conflict('SUPPORT_TICKET_IMMUTABLE_FIELDS');

        // Reuse the entity to prove this is exactly ONE legal transition of the
        // persisted history, not merely a self-consistent replacement snapshot.
        const episode = next.episodes[next.episodes.length - 1];
        try {
          if (next.status === 'OPEN')
            previous.reopen(episode.openedBy, next.updatedAt, next.episodeId);
          else if (next.status === 'CLOSED') previous.close(episode.endedBy!, next.updatedAt);
          else previous.cancel(episode.endedBy!, next.updatedAt);
        } catch (error) {
          if (error instanceof SupportTicketError) this.conflict(error.code);
          throw error;
        }
        if (!isDeepStrictEqual(previous.toProps(), next))
          this.conflict('SUPPORT_TICKET_INVALID_TRANSITION');
        const result = await this.collection().updateOne(
          {
            ...scope,
            revision: expectedRevision,
            status: before.status,
            episodeId: before.episodeId,
          },
          {
            $set: {
              status: snapshot.status,
              revision: snapshot.revision,
              episodeId: snapshot.episodeId,
              episodes: snapshot.episodes,
              decisionReferences: snapshot.decisionReferences,
              updatedAt: snapshot.updatedAt,
            },
          },
          { session, upsert: false },
        );
        if (result.acknowledged !== true) this.unconfirmed(next, undefined, expectedRevision);
        if (result.matchedCount === 0 && result.modifiedCount === 0) return false;
        if (result.matchedCount !== 1 || result.modifiedCount !== 1)
          this.unconfirmed(next, undefined, expectedRevision);
        await this.appendAudit(
          session,
          next,
          `SUPPORT_TICKET_${next.status === 'OPEN' ? 'REOPENED' : next.status}`,
          next.status === 'OPEN' ? episode.openedBy : episode.endedBy!,
          expectedRevision,
        );
        return true;
      },
      next,
      expectedRevision,
    );
  }

  private read(snapshot: unknown): SupportTicketEntity {
    try {
      return supportTicketFromSnapshot(snapshot);
    } catch {
      throw new ServiceUnavailableException({
        code: 'SUPPORT_TICKET_SNAPSHOT_INVALID',
        message: 'Stored Support Ticket is invalid',
      });
    }
  }

  private collection() {
    return this.model.db.collection<SupportTicket>(this.model.collection.name);
  }

  private async atomic<T>(
    work: (session: ClientSession) => Promise<T>,
    props: SupportTicketProps,
    expectedRevision?: number,
  ): Promise<T> {
    const connection = this.model.db;
    const hello = await connection.db?.admin().command({ hello: 1 });
    if (!hello?.setName && hello?.msg !== 'isdbgrid') {
      throw new ServiceUnavailableException({
        code: 'MONGO_TRANSACTIONS_REQUIRED',
        message: 'This mutation requires a transaction-capable MongoDB deployment',
        details: [{ resourceId: props.ticketId, mutationCommitted: false, retrySafe: false }],
      });
    }
    const session = await connection.startSession();
    let commitStarted = false;
    try {
      // Support uses the Core API deliberately: withTransaction (also used by
      // Mongoose transaction()) can replay work after mixed-label commit code 50.
      // Execute business state + audit once. Never restart this transaction.
      session.startTransaction({
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
        maxCommitTimeMS: 10000,
      });
      requireActiveTransaction(session);
      const result = await work(session);
      commitStarted = true;
      // The driver may internally retry the commit command on this same
      // transaction/session. We add no commit loop or business-callback retry.
      await session.commitTransaction();
      return result;
    } catch (error) {
      // Abort only before attempting commit. Once commit has been attempted,
      // neither an abort nor a second transaction can establish its outcome.
      if (!commitStarted && session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {
          this.logger.error('Support Ticket transaction abort failed; original error retained');
        }
      }
      if (commitStarted || hasUnknownTransactionCommitResult(error)) {
        this.unconfirmed(props, error, expectedRevision);
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        {
          code: 'ATOMIC_MUTATION_ABORTED',
          message: 'Ticket state and audit were not committed; reconcile before retrying',
          details: [{ resourceId: props.ticketId, mutationCommitted: false, retrySafe: false }],
        },
        { cause: error },
      );
    } finally {
      try {
        await session.endSession();
      } catch {
        this.logger.error('Support Ticket session cleanup failed; established outcome retained');
      }
    }
  }

  private async appendAudit(
    session: ClientSession,
    props: SupportTicketProps,
    action: string,
    actorUserId: string,
    expectedRevision?: number,
  ) {
    requireActiveTransaction(session);
    await this.audit(session, this.model.db).append({
      actorUserId,
      organizationId: props.organizationId,
      action,
      resourceType: 'SUPPORT_TICKET',
      resourceId: props.ticketId,
      metadata: {
        episodeId: props.episodeId,
        ...(expectedRevision === undefined ? {} : { expectedRevision: String(expectedRevision) }),
        revision: String(props.revision),
        status: props.status,
      },
    });
  }
  private conflict(code: string): never {
    throw new ConflictException({ code, message: 'Support Ticket write rejected' });
  }
  private unconfirmed(
    props: SupportTicketProps,
    cause?: unknown,
    expectedRevision?: number,
  ): never {
    throw new ServiceUnavailableException(
      {
        code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED',
        message: 'Reconcile the original Ticket before retrying',
        details: [
          {
            resourceId: props.ticketId,
            organizationId: props.organizationId,
            episodeId: props.episodeId,
            revision: props.revision,
            ...(expectedRevision === undefined ? {} : { expectedRevision }),
            mutationCommitted: 'unknown',
            retrySafe: false,
          },
        ],
      },
      { cause },
    );
  }
}
