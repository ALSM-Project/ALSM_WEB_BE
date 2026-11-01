import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import {
  CustomerConsentAction,
  CustomerConsentState,
  customerConsentNextState,
} from '../src/modules/support/domain/customer-consent.types';
import { validateTicketConsentBoundary } from '../src/modules/support/domain/ticket-consent-boundary.policy';
import {
  consentDataCopy,
  consentProposal,
} from '../src/modules/support/domain/customer-consent.validation';
import {
  consentBoundaryFixture,
  consentIds,
  consentNow,
  consentRequestCommand,
  consentSourceFixture,
  consentTicketFixture,
  pendingConsentFixture,
} from './customer-consent.fixtures';

describe('Customer Consent immutable pending/negative domain', () => {
  it('creates an exactly bound pending request with version, provenance, explicit coverage and no TTL', () => {
    const p = pendingConsentFixture().toProps();
    expect(p).toMatchObject({
      schemaVersion: 1,
      consentId: consentIds.consent,
      ticketId: consentIds.ticket,
      organizationId: consentIds.organization,
      episodeId: consentIds.episode,
      purposeId: 'diagnose',
      state: 'PENDING_VERIFICATION',
      revision: 0,
      createdAt: consentNow,
      updatedAt: consentNow,
    });
    expect(p.history).toHaveLength(1);
    expect(p.history[0]).toMatchObject({
      from: 'NOT_REQUESTED',
      to: 'PENDING_VERIFICATION',
      source: consentSourceFixture(),
    });
    expect(p.coverage.accountId).toBe(p.beneficiary.identity.accountId);
    for (const field of [
      'expiresAt',
      'ttl',
      'ttlHours',
      'internalApproval',
      'mfaProof',
      'supportSession',
      'accessGrant',
    ])
      expect(p).not.toHaveProperty(field);
  });
  it('keeps input and returned data detached, including Dates and nested evidence/history', () => {
    const source = pendingConsentFixture().toProps();
    const original = consentDataCopy(source);
    const consent = CustomerConsentEntity.fromPersistence(source);
    Object.assign(source.scope, { projectionId: 'changed' });
    source.createdAt.setUTCFullYear(2000);
    Object.assign(source.history[0].source, { evidenceId: 'changed' });
    const output = consent.toProps();
    output.history[0].at.setUTCFullYear(2000);
    Object.assign(output.coverage, { personId: 'changed' });
    expect(consent.toProps()).toEqual(original);
  });
  it.each(['DECLINE', 'INVALIDATE'] as const)('returns a new retained version for %s', (action) => {
    const pending = pendingConsentFixture();
    const next = pending.transition({
      action,
      actorUserId: consentIds.actor,
      source: consentSourceFixture('decision-1'),
      now: new Date(consentNow.getTime() + 1),
      reason: action === 'INVALIDATE' ? 'TICKET_CLOSED' : null,
    });
    expect(pending.toProps().state).toBe('PENDING_VERIFICATION');
    expect(next.toProps()).toMatchObject({
      state: action === 'DECLINE' ? 'DECLINED' : 'INVALIDATED',
      revision: 1,
    });
    expect(next.toProps().history[0]).toEqual(pending.toProps().history[0]);
  });
  it.each(['CLOSED', 'CANCELLED'] as const)('cannot request against a %s Ticket', (status) => {
    const ticket = consentTicketFixture();
    if (status === 'CLOSED') ticket.close(consentIds.actor, consentNow);
    else ticket.cancel(consentIds.actor, consentNow);
    const p = pendingConsentFixture().toProps();
    expect(() =>
      CustomerConsentEntity.request({
        consentId: p.consentId,
        ticket,
        episodeId: p.episodeId,
        proposal: consentRequestCommand().proposal,
        grantor: p.grantor,
        customerAuthority: p.customerAuthority,
        actorUserId: consentIds.actor,
        source: p.requestSource,
        now: consentNow,
      }),
    ).toThrow('CUSTOMER_CONSENT_CONTEXT_MISMATCH');
  });
  it('cannot reuse a prior episode to request consent after Ticket reopening', () => {
    const ticket = consentTicketFixture();
    ticket.close(consentIds.actor, consentNow);
    ticket.reopen(consentIds.actor, consentNow, consentIds.nextEpisode);
    const p = pendingConsentFixture().toProps();
    expect(() =>
      CustomerConsentEntity.request({
        consentId: p.consentId,
        ticket,
        episodeId: p.episodeId,
        proposal: consentRequestCommand().proposal,
        grantor: p.grantor,
        customerAuthority: p.customerAuthority,
        actorUserId: consentIds.actor,
        source: p.requestSource,
        now: consentNow,
      }),
    ).toThrow('CUSTOMER_CONSENT_CONTEXT_MISMATCH');
  });
  it.each(['VERIFIED_GRANTED', 'WITHDRAWN', 'EXPIRED', 'SUPERSEDED', 'NOT_REQUESTED', 'UNKNOWN'])(
    'does not import an unsupported or caller-forged %s state',
    (state) => {
      const props = pendingConsentFixture().toProps();
      Object.assign(props, { state });
      expect(() => CustomerConsentEntity.fromPersistence(props)).toThrow();
    },
  );
  it.each([
    'DECLINED',
    'WITHDRAWN',
    'EXPIRED',
    'INVALIDATED',
    'SUPERSEDED',
  ] as CustomerConsentState[])('never reactivates terminal %s', (state) => {
    for (const action of [
      'REQUEST',
      'GRANT',
      'DECLINE',
      'INVALIDATE',
      'WITHDRAW',
    ] as CustomerConsentAction[])
      expect(() => customerConsentNextState(state, action)).toThrow(
        'CUSTOMER_CONSENT_INVALID_TRANSITION',
      );
  });
  it.each(['NOT_REQUESTED', 'PENDING_VERIFICATION', 'VERIFIED_GRANTED'] as CustomerConsentState[])(
    'never grants from %s',
    (state) => {
      expect(() => customerConsentNextState(state, 'GRANT')).toThrow(
        'CUSTOMER_CONSENT_VERIFICATION_UNAVAILABLE',
      );
    },
  );
  it('models only the supported state edges', () => {
    expect(customerConsentNextState('NOT_REQUESTED', 'REQUEST')).toBe('PENDING_VERIFICATION');
    expect(customerConsentNextState('PENDING_VERIFICATION', 'DECLINE')).toBe('DECLINED');
    expect(customerConsentNextState('PENDING_VERIFICATION', 'INVALIDATE')).toBe('INVALIDATED');
    for (const action of ['REQUEST', 'WITHDRAW', 'EXPIRE', 'SUPERSEDE'] as CustomerConsentAction[])
      expect(() => customerConsentNextState('PENDING_VERIFICATION', action)).toThrow();
  });
  it.each(['UC67_MAPPING_CHANGE', 'UC67_RETRY_CONVERSION', 'CUSTOMER_BUSINESS_MUTATION'])(
    'rejects proposed operation %s',
    (operation) => {
      const proposal = consentRequestCommand().proposal;
      Object.assign(proposal.scope, { operation });
      expect(() => consentProposal(proposal)).toThrow();
    },
  );
  it.each([
    { useCase: 'UC67' },
    { mode: 'CUSTOMER_WRITE' },
    { projectionId: '' },
    { environmentId: '' },
    { purposeId: '' },
  ])('rejects invalid scope %j', (patch) => {
    const proposal = consentRequestCommand().proposal;
    Object.assign(proposal.scope, patch);
    expect(() => consentProposal(proposal)).toThrow();
  });
  it.each(['personId', 'accountId'] as const)(
    'rejects mismatched individual coverage %s',
    (field) => {
      const proposal = consentRequestCommand().proposal;
      Object.assign(proposal.coverage, { [field]: 'different' });
      expect(() => consentProposal(proposal)).toThrow();
    },
  );
  it('rejects missing/cohort coverage, credentials, authority flags and other extra record fields', () => {
    for (const coverage of [
      null,
      undefined,
      { kind: 'COHORT', personId: 'any', accountId: consentIds.beneficiary },
    ]) {
      const proposal = consentRequestCommand().proposal;
      Object.assign(proposal, { coverage });
      expect(() => consentProposal(proposal)).toThrow();
    }
    for (const field of [
      'verified',
      'approved',
      'credential',
      'rawEvidence',
      'expiresAt',
      'operationalAccess',
    ]) {
      const p = pendingConsentFixture().toProps();
      Object.assign(p, { [field]: true });
      expect(() => CustomerConsentEntity.fromPersistence(p)).toThrow();
    }
  });
  it('rejects getters, inherited fields, cycles and invalid Dates without invoking accessors', () => {
    const getter = jest.fn(() => 'secret');
    const value = { ...consentRequestCommand().proposal };
    Object.defineProperty(value, 'scope', { get: getter });
    expect(() => consentDataCopy(value)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => consentDataCopy(Object.create(value))).toThrow();
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(() => consentDataCopy(cycle)).toThrow();
    expect(() => consentDataCopy(new Date(NaN))).toThrow();
  });
  it('rejects duplicate source decisions, invalid actor attribution and backwards times', () => {
    const p = pendingConsentFixture();
    expect(() =>
      p.transition({
        action: 'DECLINE',
        actorUserId: consentIds.actor,
        source: consentSourceFixture(),
        now: consentNow,
        reason: null,
      }),
    ).toThrow('CUSTOMER_CONSENT_EVENT_REUSED');
    expect(() =>
      p.transition({
        action: 'DECLINE',
        actorUserId: consentIds.beneficiary,
        source: consentSourceFixture('refusal'),
        now: consentNow,
        reason: null,
      }),
    ).toThrow();
    expect(() =>
      p.transition({
        action: 'DECLINE',
        actorUserId: consentIds.actor,
        source: consentSourceFixture('refusal'),
        now: new Date(consentNow.getTime() - 1),
        reason: null,
      }),
    ).toThrow();
  });
  it('rejects revision/history mismatches and fabricated verified history', () => {
    for (const patch of [
      { revision: 1 },
      { revision: -1 },
      { revision: 0.1 },
      { schemaVersion: 2 },
      { updatedAt: new Date(consentNow.getTime() + 1) },
    ]) {
      const p = pendingConsentFixture().toProps();
      Object.assign(p, patch);
      expect(() => CustomerConsentEntity.fromPersistence(p)).toThrow();
    }
    const p = pendingConsentFixture().toProps();
    Object.assign(p.history[0], { to: 'VERIFIED_GRANTED' });
    expect(() => CustomerConsentEntity.fromPersistence(p)).toThrow();
  });
  it('leaves the S1 TC A boundary denial-only even with coherent CURRENT references', () => {
    const result = validateTicketConsentBoundary(consentBoundaryFixture());
    expect(result).toEqual({
      outcome: 'DENY',
      operationalAccess: false,
      reason: 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED',
    });
  });
});
