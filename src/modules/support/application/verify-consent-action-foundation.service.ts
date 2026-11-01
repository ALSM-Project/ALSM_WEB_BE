import {
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { CustomerConsentAuthorityRequest } from './customer-consent-authority.port';
import { consentInput } from './customer-consent-context.service';
import {
  consentDataCopy,
  consentShape,
  freezeConsentData,
} from '../domain/customer-consent.validation';
import { SUPPORT_TICKET_ACCESS, SupportTicketAccessPort } from './support-ticket-access.port';
import {
  CONSENT_VERIFICATION_POLICY,
  CONSENT_VERIFICATION_SOURCE,
  CONSENT_INTENT_CONSUMPTION,
  ConsentVerificationPolicyPort,
  ConsentVerificationSourcePort,
  DurableIntentConsumption,
  DurableIntentConsumptionPort,
} from './consent-verification-foundation.port';
import {
  captureConsentVerificationRequest,
  captureConsentVerificationPolicy,
  captureConsentVerificationEvidence,
} from './consent-verification-foundation.validation';

/**
 * Unregistered E5A orchestration, NOT CustomerConsentAuthorityPort or an access grant.
 * A future caller must retain E1/E3 JWT/session, scoped Ticket and lifecycle checks.
 * No production policy, trusted source, challenge issuer or consumer is supplied.
 */
@Injectable()
export class VerifyConsentActionFoundationService {
  constructor(
    @Optional() @Inject(SUPPORT_TICKET_ACCESS) private readonly owners?: SupportTicketAccessPort,
    @Optional()
    @Inject(CONSENT_VERIFICATION_POLICY)
    private readonly policies?: ConsentVerificationPolicyPort,
    @Optional()
    @Inject(CONSENT_VERIFICATION_SOURCE)
    private readonly source?: ConsentVerificationSourcePort,
    @Optional()
    @Inject(CONSENT_INTENT_CONSUMPTION)
    private readonly consumption?: DurableIntentConsumptionPort,
  ) {}

  async execute(input: CustomerConsentAuthorityRequest) {
    const request = consentInput(() => captureConsentVerificationRequest(input));
    if (!this.owners || !this.policies || !this.source || !this.consumption) this.denied();
    const owner = () =>
      this.checked(
        () =>
          this.owners!.authorize({
            actorUserId: request.actorUserId,
            organizationId: request.ticket.organizationId,
            ticketId: request.ticket.ticketId,
            action: 'READ',
          }),
        (allowed) => {
          if (allowed !== true) this.denied();
        },
      );
    let envelope: DurableIntentConsumption;
    try {
      await owner();
      const capturedPolicy = await this.checked(
        () => this.policies!.current(),
        captureConsentVerificationPolicy,
      );
      const evidence = await this.checked(
        () => this.source!.resolve(freezeConsentData({ request, policy: capturedPolicy })),
        (value) => captureConsentVerificationEvidence(value, request, capturedPolicy, Date.now()),
      );
      await owner();
      const currentPolicy = await this.checked(
        () => this.policies!.current(),
        captureConsentVerificationPolicy,
      );
      if (!isDeepStrictEqual(currentPolicy, capturedPolicy)) this.denied();
      // Recheck expiry after all intervening waits. The future consumer must also
      // condition its transaction on expiry and exact current local trust versions.
      const currentEvidence = this.validated(() =>
        captureConsentVerificationEvidence(evidence, request, capturedPolicy, Date.now()),
      );
      envelope = freezeConsentData({
        consumptionId: randomUUID(),
        request,
        policy: capturedPolicy,
        evidence: currentEvidence,
      });
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException({
        code: 'CONSENT_VERIFICATION_SOURCE_UNAVAILABLE',
        message: 'Consent verification prerequisites could not be confirmed',
      });
    }
    let outcome: 'CONFIRMED' | 'REJECTED' | 'UNCONFIRMED';
    try {
      const response = consentDataCopy(await this.consumption!.consume(envelope));
      consentShape(response, ['outcome', 'consumptionId', 'verificationAttemptId', 'challengeId']);
      if (
        response.consumptionId !== envelope.consumptionId ||
        response.verificationAttemptId !== request.verificationAttemptId ||
        response.challengeId !== envelope.evidence.challenge.challengeId ||
        !['CONFIRMED', 'REJECTED', 'UNCONFIRMED'].includes(response.outcome)
      )
        return this.unconfirmed(envelope);
      outcome = response.outcome;
    } catch {
      return this.unconfirmed(envelope);
    }
    if (outcome === 'REJECTED') this.denied();
    if (outcome !== 'CONFIRMED') return this.unconfirmed(envelope);
    return Object.freeze({
      outcome: 'CONSUMED' as const,
      consumptionId: envelope.consumptionId,
      operationalAccess: false as const,
    });
  }

  private async checked<T, R>(read: () => Promise<T | null>, capture: (value: T) => R): Promise<R> {
    let value: T | null;
    try {
      value = await read();
    } catch {
      throw new Error('Consent verification source unavailable');
    }
    if (!value) this.denied();
    return this.validated(() => capture(value!));
  }
  private validated<T>(capture: () => T): T {
    try {
      return capture();
    } catch {
      return this.denied();
    }
  }
  private denied(): never {
    throw new ForbiddenException({
      code: 'CONSENT_VERIFICATION_FOUNDATION_DENIED',
      message: 'Independent Consent verification prerequisites are required',
    });
  }
  private unconfirmed(input: DurableIntentConsumption): never {
    throw new ServiceUnavailableException({
      code: 'CONSENT_INTENT_CONSUMPTION_UNCONFIRMED',
      message: 'Reconcile the original consumption identity before any new attempt',
      details: [
        {
          consumptionId: input.consumptionId,
          verificationAttemptId: input.request.verificationAttemptId,
          challengeId: input.evidence.challenge.challengeId,
          consentId: input.request.consentId,
          organizationId: input.request.ticket.organizationId,
          ticketId: input.request.ticket.ticketId,
          episodeId: input.request.ticket.episodeId,
          action: input.request.action,
          mutationCommitted: 'unknown',
          retrySafe: false,
        },
      ],
    });
  }
}
