import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import {
  hasUnknownTransactionCommitResult,
  requireActiveTransaction,
} from '../../../shared/database/mongo-transaction-runner';
import type { AuditRepository } from '../../audit/domain/audit.repository';
import { CustomerConsentError } from '../domain/customer-consent.types';
import type { CustomerConsentAuthorityRequest } from '../application/customer-consent-authority.port';
import type {
  ConsentIntentReconciliation,
  ConsentIntentWriteOutcome,
  SyntheticConsentIntentRegistration,
  SyntheticConsentIntentRegistrationPort,
} from '../application/consent-intent-persistence.port';
import type {
  DurableIntentConsumption,
  DurableIntentConsumptionPort,
  DurableIntentConsumptionResult,
} from '../application/consent-verification-foundation.port';
import { captureConsentVerificationRequest } from '../application/consent-verification-foundation.validation';
import {
  consentDataCopy,
  consentShape,
  consentUuid,
  freezeConsentData,
} from '../domain/customer-consent.validation';
import {
  captureIntentConsumption,
  captureIntentRegistration,
  intentCanonical,
  intentAudit,
  intentAuditId,
  intentChallenge,
  intentChallengeFromSnapshot,
  intentContextFields,
  intentHash,
  intentReceiptFromSnapshot,
  intentTrustFromSnapshot,
  intentTrustRecords,
} from './consent-intent.mapper';
import {
  CONSENT_INTENT_AUDIT_INDEX,
  CONSENT_INTENT_AUDIT_TYPE,
  CONSENT_INTENT_CHALLENGE_INDEXES,
  CONSENT_INTENT_RECEIPT_INDEXES,
  ConsentIntentChallengeSnapshot,
  ConsentIntentIndex,
  ConsentIntentReceiptSnapshot,
  ConsentIntentTrustSnapshot,
} from './consent-intent.schema';

export interface ConsentIntentModels {
  readonly challenges: Model<ConsentIntentChallengeSnapshot>;
  readonly trust: Model<ConsentIntentTrustSnapshot>;
  readonly receipts: Model<ConsentIntentReceiptSnapshot>;
  readonly audits: { readonly db: Connection; readonly collection: { readonly name: string } };
}
export type ConsentIntentAuditFactory = (
  session: ClientSession,
  connection: Connection,
) => AuditRepository;
class IntentConflict extends Error {}
class IntentUnconfirmed extends Error {}
class IntentEvidenceMismatch extends Error {}

/** Isolated SYNTHETIC ledger only. Never registered in production; authenticates no external proof. */
export class MongoConsentIntentConsumption
  implements DurableIntentConsumptionPort, SyntheticConsentIntentRegistrationPort
{
  private readonly logger = new Logger(MongoConsentIntentConsumption.name);
  private readonly connection: Connection;
  constructor(
    private readonly models: ConsentIntentModels,
    private readonly audit: ConsentIntentAuditFactory,
  ) {
    this.connection = models.challenges.db;
    if (
      typeof audit !== 'function' ||
      Object.values(models).some((model) => model.db !== this.connection)
    )
      throw new Error('Consent intent models and transaction audit must share one connection');
  }
  private get challenges() {
    return this.connection.collection<ConsentIntentChallengeSnapshot>(
      this.models.challenges.collection.name,
    );
  }
  private get trust() {
    return this.connection.collection<ConsentIntentTrustSnapshot>(
      this.models.trust.collection.name,
    );
  }
  private get receipts() {
    return this.connection.collection<ConsentIntentReceiptSnapshot>(
      this.models.receipts.collection.name,
    );
  }
  private get audits() {
    return this.connection.collection(this.models.audits.collection.name);
  }
  private options(session: ClientSession) {
    return { session, collation: { locale: 'simple' } };
  }

  async registerSynthetic(
    input: SyntheticConsentIntentRegistration,
  ): Promise<ConsentIntentWriteOutcome> {
    const atMs = Date.now();
    const registration = this.input(() => captureIntentRegistration(input, atMs));
    const challenge = intentChallenge(registration, atMs);
    return this.atomic(async (session) => {
      for (const expected of intentTrustRecords(registration)) {
        const raw = await this.trust.findOne({ _id: expected._id }, this.options(session));
        if (raw) {
          const existing = this.snapshot(() => intentTrustFromSnapshot(raw));
          if (
            existing.state !== 'CURRENT' ||
            !isDeepStrictEqual(existing.payload, expected.payload)
          )
            throw new IntentConflict();
        } else {
          const inserted = await this.trust.insertOne(expected, { session });
          if (inserted.acknowledged !== true || inserted.insertedId !== expected._id)
            throw new IntentUnconfirmed();
        }
      }
      const inserted = await this.challenges.insertOne(challenge, { session });
      if (inserted.acknowledged !== true || inserted.insertedId !== challenge._id)
        throw new IntentUnconfirmed();
    });
  }

  async consume(input: DurableIntentConsumption): Promise<DurableIntentConsumptionResult> {
    // Capture the complete envelope before the first index/storage wait.
    const c = this.input(() => captureIntentConsumption(input, Date.now()));
    const registration = freezeConsentData(
      intentCanonical({ request: c.request, policy: c.policy, evidence: c.evidence }),
    );
    const outcome = await this.atomic(async (session) => {
      const scope = this.scope(c.request, c.evidence.challenge.challengeId);
      const raw = await this.challenges.findOne(scope, this.options(session));
      if (!raw) throw new IntentConflict();
      const challenge = this.snapshot(() => intentChallengeFromSnapshot(raw));
      if (
        challenge.state !== 'ISSUED' ||
        challenge.revision !== 0 ||
        !isDeepStrictEqual(challenge.registration, registration)
      )
        throw new IntentConflict();
      for (const expected of intentTrustRecords(registration)) {
        const rawTrust = await this.trust.findOne({ _id: expected._id }, this.options(session));
        if (!rawTrust) throw new IntentConflict();
        const current = this.snapshot(() => intentTrustFromSnapshot(rawTrust));
        if (
          current.state !== 'CURRENT' ||
          current.fence >= Number.MAX_SAFE_INTEGER ||
          !isDeepStrictEqual(current.payload, expected.payload)
        )
          throw new IntentConflict();
        // A read alone would allow revocation/write skew. Touch each shared local
        // projection so a concurrent revocation/change conflicts with this transaction.
        const fenced = await this.trust.updateOne(
          {
            _id: expected._id,
            state: 'CURRENT',
            fence: current.fence,
            payloadHash: expected.payloadHash,
            payload: expected.payload,
          },
          { $inc: { fence: 1 } },
          this.options(session),
        );
        this.updated(fenced);
      }
      const consumedAtMs = Date.now();
      try {
        captureIntentRegistration(registration, consumedAtMs);
      } catch {
        throw new IntentConflict();
      } // Eligibility may expire during storage waits.
      const changed = await this.challenges.updateOne(
        {
          ...scope,
          verificationAttemptId: c.request.verificationAttemptId,
          state: 'ISSUED',
          revision: 0,
          contextHash: intentHash(registration),
          registration,
          proofIssuerId: challenge.proofIssuerId,
          proofId: challenge.proofId,
          nonceSha256: challenge.nonceSha256,
          $expr: { $gt: ['$registration.evidence.challenge.expiresAtMs', { $toLong: '$$NOW' }] },
        },
        { $set: { state: 'CONSUMED', revision: 1, consumptionId: c.consumptionId, consumedAtMs } },
        this.options(session),
      );
      this.updated(changed);
      const attribution = intentAudit(registration, c.consumptionId, consumedAtMs);
      await this.audit(session, this.connection).append(attribution);
      const entries = await this.audits
        .find(
          { resourceType: CONSENT_INTENT_AUDIT_TYPE, resourceId: c.consumptionId },
          this.options(session),
        )
        .limit(2)
        .toArray();
      if (entries.length !== 1) this.unavailable('CONSENT_INTENT_AUDIT_INVALID');
      const auditId = this.snapshot(() => intentAuditId(entries[0], attribution));
      const receipt: ConsentIntentReceiptSnapshot = {
        _id: c.consumptionId,
        ...intentContextFields(registration, challenge.registeredAtMs),
        challengeId: challenge._id,
        state: 'CONSUMED',
        revision: 1,
        consumedAtMs,
        auditId,
      };
      this.snapshot(() => intentReceiptFromSnapshot(receipt));
      const inserted = await this.receipts.insertOne(receipt, { session });
      if (inserted.acknowledged !== true || inserted.insertedId !== c.consumptionId)
        throw new IntentUnconfirmed();
    });
    return Object.freeze({
      outcome: outcome === 'CONFLICT' ? 'REJECTED' : outcome,
      consumptionId: c.consumptionId,
      verificationAttemptId: c.request.verificationAttemptId,
      challengeId: c.evidence.challenge.challengeId,
    });
  }

  async reconcile(input: {
    readonly consumptionId: string;
    readonly request: CustomerConsentAuthorityRequest;
    readonly challengeId: string;
  }): Promise<ConsentIntentReconciliation> {
    const c = this.input(() => {
      const value = consentDataCopy(input);
      consentShape(value, ['consumptionId', 'request', 'challengeId']);
      consentUuid(value.consumptionId);
      consentUuid(value.challengeId);
      return freezeConsentData({
        ...value,
        request: captureConsentVerificationRequest(value.request),
      });
    });
    const result = (status: ConsentIntentReconciliation['status']): ConsentIntentReconciliation =>
      Object.freeze({
        outcome:
          status === 'COMMITTED'
            ? 'CONFIRMED'
            : status === 'ALREADY_CONSUMED'
              ? 'REJECTED'
              : 'UNCONFIRMED',
        consumptionId: c.consumptionId,
        verificationAttemptId: c.request.verificationAttemptId,
        challengeId: c.challengeId,
        status,
        operationalAccess: false,
      });
    await this.ready();
    const session = await this.session();
    let commitStarted = false;
    try {
      this.begin(session);
      const raw = await this.challenges.findOne(
        this.scope(c.request, c.challengeId),
        this.options(session),
      );
      if (!raw)
        throw new ForbiddenException({
          code: 'CONSENT_INTENT_RECONCILIATION_DENIED',
          message: 'Consent intent evidence is unavailable in this scope',
        });
      let status: ConsentIntentReconciliation['status'];
      try {
        const challenge = intentChallengeFromSnapshot(raw);
        if (!isDeepStrictEqual(challenge.registration.request, c.request))
          throw new IntentEvidenceMismatch();
        const receiptRaw = await this.receipts.findOne(
          { _id: c.consumptionId, ...this.actorScope(c.request) },
          this.options(session),
        );
        if (receiptRaw) {
          const receipt = intentReceiptFromSnapshot(receiptRaw);
          status = (await this.committed(receipt, challenge, session))
            ? 'COMMITTED'
            : 'EVIDENCE_INCONSISTENT';
        } else if (challenge.state === 'CONSUMED') {
          const previous = await this.receipts.findOne(
            { challengeId: c.challengeId, ...this.actorScope(c.request) },
            this.options(session),
          );
          status =
            previous &&
            (await this.committed(intentReceiptFromSnapshot(previous), challenge, session))
              ? 'ALREADY_CONSUMED'
              : 'EVIDENCE_INCONSISTENT';
        } else {
          const proof = c.request.source!;
          // Scoped evidence only: never read/disclose another Organisation's receipt.
          const prior = await this.receipts.findOne(
            {
              proofIssuerId: proof.authorityId,
              proofId: proof.evidenceId,
              ...this.actorScope(c.request),
            },
            this.options(session),
          );
          if (!prior) status = 'ABSENT_UNCERTAIN';
          else {
            const receipt = intentReceiptFromSnapshot(prior);
            const priorChallenge = await this.challenges.findOne(
              { _id: receipt.challengeId, ...this.actorScope(c.request) },
              this.options(session),
            );
            status =
              priorChallenge &&
              (await this.committed(receipt, intentChallengeFromSnapshot(priorChallenge), session))
                ? 'ALREADY_CONSUMED'
                : 'EVIDENCE_INCONSISTENT';
          }
        }
      } catch (error) {
        if (!(error instanceof CustomerConsentError) && !(error instanceof IntentEvidenceMismatch))
          throw error;
        status = 'EVIDENCE_INCONSISTENT';
      }
      commitStarted = true;
      await session.commitTransaction();
      return result(status);
    } catch (error) {
      if (!commitStarted) await this.abort(session);
      if (error instanceof ForbiddenException) throw error;
      return result('EVIDENCE_UNAVAILABLE');
    } finally {
      await this.end(session);
    }
  }
  private async committed(
    receipt: ConsentIntentReceiptSnapshot,
    challenge: ConsentIntentChallengeSnapshot,
    session: ClientSession,
  ) {
    if (
      challenge.state !== 'CONSUMED' ||
      challenge.consumptionId !== receipt._id ||
      challenge._id !== receipt.challengeId ||
      challenge.consumedAtMs !== receipt.consumedAtMs ||
      challenge.registeredAtMs !== receipt.registeredAtMs ||
      !isDeepStrictEqual(challenge.registration, receipt.registration)
    )
      return false;
    const entries = await this.audits
      .find(
        {
          resourceType: CONSENT_INTENT_AUDIT_TYPE,
          resourceId: receipt._id,
          organizationId: receipt.organizationId,
          actorUserId: receipt.actorUserId,
        },
        this.options(session),
      )
      .limit(2)
      .toArray();
    return (
      entries.length === 1 &&
      intentAuditId(
        entries[0],
        intentAudit(receipt.registration, receipt._id, receipt.consumedAtMs),
      ).equals(receipt.auditId)
    );
  }
  private actorScope(request: CustomerConsentAuthorityRequest) {
    return {
      organizationId: new Types.ObjectId(request.ticket.organizationId),
      actorUserId: new Types.ObjectId(request.actorUserId),
    };
  }
  private scope(request: CustomerConsentAuthorityRequest, challengeId: string) {
    return {
      _id: challengeId,
      ...this.actorScope(request),
      ticketId: request.ticket.ticketId,
      episodeId: request.ticket.episodeId,
    };
  }
  private updated(result: { acknowledged: boolean; matchedCount: number; modifiedCount: number }) {
    if (result.acknowledged !== true) throw new IntentUnconfirmed();
    if (result.matchedCount === 0 && result.modifiedCount === 0) throw new IntentConflict();
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) throw new IntentUnconfirmed();
  }
  private async ready() {
    try {
      const required = [
        [this.challenges, CONSENT_INTENT_CHALLENGE_INDEXES],
        [this.receipts, CONSENT_INTENT_RECEIPT_INDEXES],
        [this.trust, []],
        [this.audits, [CONSENT_INTENT_AUDIT_INDEX]],
      ] as const;
      for (const [collection, specs] of required) {
        const indexes = await collection.indexes();
        if (
          !indexes.some((i) => i.name === '_id_' && isDeepStrictEqual(i.key, { _id: 1 })) ||
          indexes.some((i) => i.expireAfterSeconds !== undefined) ||
          specs.some((spec) => !indexes.some((i) => this.indexMatches(i, spec)))
        )
          this.unavailable('CONSENT_INTENT_INDEX_REQUIRED');
      }
    } catch {
      this.unavailable('CONSENT_INTENT_INDEX_REQUIRED');
    }
    try {
      const hello = await this.connection.db!.admin().command({ hello: 1 });
      if (!hello?.setName && hello?.msg !== 'isdbgrid')
        this.unavailable('MONGO_TRANSACTIONS_REQUIRED');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.unavailable('CONSENT_INTENT_PERSISTENCE_UNAVAILABLE');
    }
  }
  private indexMatches(index: Record<string, unknown>, spec: ConsentIntentIndex) {
    const collation = index.collation as { locale?: string } | undefined;
    return (
      index.name === spec.name &&
      index.unique === true &&
      !index.sparse &&
      isDeepStrictEqual(index.key, spec.key) &&
      isDeepStrictEqual(index.partialFilterExpression, spec.partialFilterExpression) &&
      (!collation || collation.locale === 'simple')
    );
  }
  private async session() {
    try {
      return await this.connection.startSession();
    } catch {
      return this.unavailable('CONSENT_INTENT_PERSISTENCE_UNAVAILABLE');
    }
  }
  private begin(session: ClientSession) {
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary',
      maxCommitTimeMS: 10000,
    });
    requireActiveTransaction(session);
  }
  private async atomic(
    work: (session: ClientSession) => Promise<void>,
  ): Promise<ConsentIntentWriteOutcome> {
    await this.ready();
    const session = await this.session();
    let commitStarted = false;
    try {
      this.begin(session);
      await work(session);
      commitStarted = true;
      await session.commitTransaction();
      return 'CONFIRMED';
    } catch (error) {
      if (!commitStarted) await this.abort(session);
      if (
        commitStarted ||
        error instanceof IntentUnconfirmed ||
        hasUnknownTransactionCommitResult(error)
      )
        return 'UNCONFIRMED';
      const code = (error as { code?: unknown } | null)?.code;
      if (error instanceof IntentConflict || code === 11000 || code === 112) return 'CONFLICT';
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException)
        throw error;
      return this.unavailable('CONSENT_INTENT_TRANSACTION_ABORTED');
    } finally {
      await this.end(session);
    }
  }
  private async abort(session: ClientSession) {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch {
      this.logger.error('Consent intent abort cleanup failed; primary outcome retained');
    }
  }
  private async end(session: ClientSession) {
    try {
      await session.endSession();
    } catch {
      this.logger.error('Consent intent session cleanup failed; primary outcome retained');
    }
  }
  private input<T>(read: () => T): T {
    try {
      return read();
    } catch {
      throw new BadRequestException({
        code: 'INVALID_CONSENT_INTENT',
        message: 'Invalid Consent intent binding',
      });
    }
  }
  private snapshot<T>(read: () => T): T {
    try {
      return read();
    } catch {
      return this.unavailable('CONSENT_INTENT_SNAPSHOT_INVALID');
    }
  }
  private unavailable(code: string): never {
    throw new ServiceUnavailableException({
      code,
      message: 'Consent intent persistence could not be confirmed',
    });
  }
}
