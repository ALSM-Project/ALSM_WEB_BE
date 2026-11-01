import { consentDataCopy } from '../src/modules/support/domain/customer-consent.validation';
import { ForbiddenException } from '@nestjs/common';
import { CustomerConsentContextService } from '../src/modules/support/application/customer-consent-context.service';
import { RequestCustomerConsentService } from '../src/modules/support/application/request-customer-consent.service';
import { TransitionCustomerConsentCommand } from '../src/modules/support/application/transition-customer-consent.service';
import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import { OrganizationRole } from '../src/modules/organizations/domain/organization.types';
import {
  consentActorFixture,
  consentApplicationFixture,
  consentIds,
  consentNow,
  consentRequestCommand,
  consentSourceFixture,
} from './customer-consent.fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { resolve, promise };
}
async function preparedConsent() {
  const f = consentApplicationFixture(),
    request = consentRequestCommand();
  const result = await f.request.execute(request);
  const command: TransitionCustomerConsentCommand = {
    ...request,
    consentId: result.consent.consentId,
    expectedRevision: 0,
    action: 'DECLINE',
    source: consentSourceFixture('refusal-1'),
  };
  return { f, request, result, command };
}

describe('Customer Consent bounded application services (synthetic ports only)', () => {
  it('requests pending consent using the existing Owner mechanism and an explicit person/source authority', async () => {
    const { f, result } = await preparedConsent();
    expect(result).toMatchObject({
      outcome: 'CONFIRMED',
      operationalAccess: false,
      consent: {
        state: 'PENDING_VERIFICATION',
        revision: 0,
        grantor: { personId: 'customer-owner-person', accountId: consentIds.actor },
      },
    });
    expect(result.consent.consentId).toMatch(/^[a-f0-9-]{36}$/);
    expect(f.tickets.findById).toHaveBeenCalledWith(consentIds.ticket, consentIds.organization);
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({
      actorUserId: consentIds.actor,
      organizationId: consentIds.organization,
      action: 'CUSTOMER_CONSENT_REQUESTED',
      resourceId: result.consent.consentId,
      metadata: {
        ticketId: consentIds.ticket,
        episodeId: consentIds.episode,
        revision: '0',
        state: 'PENDING_VERIFICATION',
        sourceEventId: 'request-1',
      },
    });
    expect(f.audits[0].metadata).not.toHaveProperty('personId');
    expect(f.audits[0].metadata).not.toHaveProperty('rawEvidence');
  });
  it.each([OrganizationRole.ADMIN, OrganizationRole.MEMBER, OrganizationRole.VIEWER])(
    'rejects %s despite forged actor/person/role/approval claims',
    async (role) => {
      const f = consentApplicationFixture();
      f.organization.members[0].role = role;
      const input = {
        ...consentRequestCommand(),
        actorId: consentIds.actor,
        personId: 'customer-owner-person',
        role: 'OWNER',
        verified: true,
        approved: true,
      };
      await expect(f.request.execute(input)).rejects.toMatchObject({ status: 403 });
      expect(f.authority.authorize).not.toHaveBeenCalled();
      expect(f.tickets.findById).not.toHaveBeenCalled();
      expect(f.consents.create).not.toHaveBeenCalled();
    },
  );
  it('ignores caller claims about grantor or verified state when the real actor is authorized', async () => {
    const f = consentApplicationFixture();
    const result = await f.request.execute({
      ...consentRequestCommand(),
      ...{
        grantor: { personId: 'forged' },
        state: 'VERIFIED_GRANTED',
        verified: true,
        internalApproval: true,
      },
    });
    expect(result.consent.state).toBe('PENDING_VERIFICATION');
    expect(result.consent.grantor.personId).toBe('customer-owner-person');
    expect(result.operationalAccess).toBe(false);
    expect(result.consent).not.toHaveProperty('internalApproval');
  });
  it('denies absent Owner/person authority providers before reading or writing a Ticket/consent', async () => {
    const f = consentApplicationFixture();
    for (const context of [
      new CustomerConsentContextService(f.tickets, f.owner),
      new CustomerConsentContextService(f.tickets, undefined, f.authority),
    ]) {
      await expect(
        new RequestCustomerConsentService(context, f.consents).execute(consentRequestCommand()),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(f.tickets.findById).not.toHaveBeenCalled();
    expect(f.consents.create).not.toHaveBeenCalled();
  });
  it('denies removed/ambiguous Owners and Support staff without using a new role or bypass', async () => {
    const f = consentApplicationFixture();
    f.organization.members.push({ ...f.organization.members[0] });
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 403 });
    f.organization.members.splice(1);
    f.staff.hasCurrentAssignment.mockResolvedValue(true);
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 403 });
    f.organization.members = [];
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 403 });
    expect(f.consents.create).not.toHaveBeenCalled();
  });
  it.each([
    'missing',
    'wrong-account',
    'wrong-organization',
    'stale-person',
    'revoked-authority',
    'representative',
    'wrong-event',
    'wrong-action',
    'wrong-scope',
    'extra-flag',
  ] as const)('denies unverified/mismatched authority: %s', async (condition) => {
    const f = consentApplicationFixture();
    f.authority.authorize.mockImplementationOnce(async (request) => {
      if (condition === 'missing') return null;
      const result = consentActorFixture(request);
      if (condition === 'wrong-account')
        Object.assign(result.actor, { accountId: consentIds.beneficiary });
      if (condition === 'wrong-organization')
        Object.assign(result.customerAuthority, { organizationId: consentIds.foreignOrganization });
      if (condition === 'stale-person') Object.assign(result.actor.provenance, { status: 'STALE' });
      if (condition === 'revoked-authority')
        Object.assign(result.customerAuthority.evidence, { status: 'REVOKED' });
      if (condition === 'representative')
        Object.assign(result.customerAuthority, { kind: 'AUTHORIZED_REPRESENTATIVE' });
      if (condition === 'wrong-event')
        Object.assign(result.request.source!, { evidenceId: 'different-event' });
      if (condition === 'wrong-action') Object.assign(result.request, { action: 'STATUS' });
      if (condition === 'wrong-scope')
        Object.assign(result.request.scope, { projectionId: 'different' });
      if (condition === 'extra-flag') Object.assign(result, { verified: true });
      return result;
    });
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 403 });
    expect(f.consents.create).not.toHaveBeenCalled();
  });
  it('fails closed on authority outages without success or false audit', async () => {
    const f = consentApplicationFixture();
    f.authority.authorize.mockRejectedValue(new Error('private provider failure'));
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({
      status: 503,
      response: { code: 'CUSTOMER_CONSENT_AUTHORITY_UNAVAILABLE' },
    });
    expect(f.consents.create).not.toHaveBeenCalled();
    expect(f.audits).toEqual([]);
  });
  it.each(['CLOSED', 'CANCELLED'] as const)(
    'rejects new requests and refusals after Ticket %s',
    async (status) => {
      const { f, request, command } = await preparedConsent();
      if (status === 'CLOSED') f.ticket().close(consentIds.actor, consentNow);
      else f.ticket().cancel(consentIds.actor, consentNow);
      await expect(
        f.request.execute({ ...request, expectedTicketRevision: 1 }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        f.transition.execute({ ...command, expectedTicketRevision: 1 }),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.consents.save).not.toHaveBeenCalled();
    },
  );
  it('rejects a Ticket that closes while customer identity verification waits', async () => {
    const f = consentApplicationFixture();
    f.authority.authorize.mockImplementationOnce(async (request) => {
      f.ticket().close(consentIds.actor, consentNow);
      return consentActorFixture(request);
    });
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 409 });
    expect(f.consents.create).not.toHaveBeenCalled();
  });
  it('retrieves only scoped status, exposing neither provenance claims nor operational authority', async () => {
    const { f, request, result } = await preparedConsent();
    const status = await f.status.execute({ ...request, consentId: result.consent.consentId });
    expect(status).toEqual({
      consentId: result.consent.consentId,
      ticketId: consentIds.ticket,
      organizationId: consentIds.organization,
      episodeId: consentIds.episode,
      state: 'PENDING_VERIFICATION',
      revision: 0,
      ticketCompatibility: 'CURRENT_EPISODE_OPEN',
      operationalAccess: false,
    });
    expect(f.consents.findById).toHaveBeenCalledWith(
      result.consent.consentId,
      consentIds.organization,
      consentIds.ticket,
    );
  });
  it.each(['DECLINE', 'INVALIDATE'] as const)(
    'performs authorized negative %s with retained history and audit attribution',
    async (action) => {
      const { f, command, result } = await preparedConsent();
      if (action === 'INVALIDATE') f.ticket().close(consentIds.actor, consentNow);
      const next = await f.transition.execute({
        ...command,
        action,
        expectedTicketRevision: action === 'INVALIDATE' ? 1 : 0,
      });
      expect(next.consent).toMatchObject({
        state: action === 'DECLINE' ? 'DECLINED' : 'INVALIDATED',
        revision: 1,
      });
      expect(next.consent.history[0]).toEqual(result.consent.history[0]);
      expect(f.audits[1]).toMatchObject({
        actorUserId: consentIds.actor,
        organizationId: consentIds.organization,
        action: `CUSTOMER_CONSENT_${next.consent.state}`,
        metadata: { expectedRevision: '0', revision: '1', sourceEventId: 'refusal-1' },
      });
      expect(next.operationalAccess).toBe(false);
      await expect(
        f.transition.execute({
          ...command,
          action,
          expectedRevision: 1,
          expectedTicketRevision: action === 'INVALIDATE' ? 1 : 0,
          source: consentSourceFixture('duplicate-intent'),
        }),
      ).rejects.toMatchObject({ status: 409 });
      expect(f.consents.save).toHaveBeenCalledTimes(1);
    },
  );
  it('does not accept a refusal attributed to another person, even on the same account', async () => {
    const { f, command } = await preparedConsent();
    f.authority.authorize.mockImplementationOnce(async (request) => {
      const result = consentActorFixture(request);
      Object.assign(result.actor, { personId: 'another-person' });
      return result;
    });
    await expect(f.transition.execute(command)).rejects.toMatchObject({ status: 403 });
    expect(f.consents.save).not.toHaveBeenCalled();
  });
  it.each(['CLOSED', 'CANCELLED', 'REOPENED'] as const)(
    'can explicitly invalidate after %s without pretending to revoke sessions',
    async (state) => {
      const { f, command, result } = await preparedConsent();
      if (state === 'CANCELLED') f.ticket().cancel(consentIds.actor, consentNow);
      else f.ticket().close(consentIds.actor, consentNow);
      if (state === 'REOPENED')
        f.ticket().reopen(consentIds.actor, consentNow, consentIds.nextEpisode);
      const revision = state === 'REOPENED' ? 2 : 1;
      const status = await f.status.execute({ ...command, expectedTicketRevision: revision });
      expect(status.state).toBe('PENDING_VERIFICATION');
      expect(status.operationalAccess).toBe(false);
      expect(status.ticketCompatibility).toBe(
        state === 'REOPENED' ? 'EPISODE_CHANGED' : `TICKET_${state}`,
      );
      const changed = await f.transition.execute({
        ...command,
        action: 'INVALIDATE',
        expectedTicketRevision: revision,
      });
      expect(changed.consent.state).toBe('INVALIDATED');
      expect(changed.consent.episodeId).toBe(consentIds.episode);
      expect(changed.consent.history[0]).toEqual(result.consent.history[0]);
      expect(changed).not.toHaveProperty('sessionsRevoked');
    },
  );
  it('requires fresh consent on a reopened episode and never mutates the prior record into the new episode', async () => {
    const { f, request, command, result } = await preparedConsent();
    f.ticket().close(consentIds.actor, consentNow);
    f.ticket().reopen(consentIds.actor, consentNow, consentIds.nextEpisode);
    await expect(
      f.request.execute({ ...request, expectedTicketRevision: 2 }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.status.execute({
        ...command,
        episodeId: consentIds.nextEpisode,
        expectedTicketRevision: 2,
      }),
    ).rejects.toMatchObject({ status: 404 });
    const next = await f.request.execute({
      ...request,
      episodeId: consentIds.nextEpisode,
      expectedTicketRevision: 2,
      source: consentSourceFixture('new-episode-request'),
    });
    expect(next.consent.consentId).not.toBe(result.consent.consentId);
    expect(next.consent.episodeId).toBe(consentIds.nextEpisode);
    expect(f.records.get(result.consent.consentId)?.episodeId).toBe(consentIds.episode);
  });
  it('does not invalidate a compatible OPEN episode merely because the caller asks', async () => {
    const { f, command } = await preparedConsent();
    await expect(f.transition.execute({ ...command, action: 'INVALIDATE' })).rejects.toMatchObject({
      status: 409,
    });
    expect(f.consents.save).not.toHaveBeenCalled();
  });
  it.each(['GRANT', 'WITHDRAW', 'EXPIRE', 'SUPERSEDE'] as const)(
    'explicitly defers %s without calling any authority or repository',
    async (action) => {
      const f = consentApplicationFixture();
      await expect(
        f.transition.execute({
          ...consentRequestCommand(),
          consentId: consentIds.consent,
          expectedRevision: 0,
          action,
          source: consentSourceFixture(),
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          code:
            action === 'GRANT'
              ? 'CUSTOMER_CONSENT_VERIFICATION_UNAVAILABLE'
              : 'CUSTOMER_CONSENT_OPERATION_UNSUPPORTED',
        },
      });
      expect(f.tickets.findById).not.toHaveBeenCalled();
      expect(f.authority.authorize).not.toHaveBeenCalled();
      expect(f.consents.findById).not.toHaveBeenCalled();
    },
  );
  it('denies cross-Organisation claims before loading any Ticket or consent', async () => {
    const { f, request, command } = await preparedConsent();
    f.tickets.findById.mockClear();
    for (const run of [
      () => f.request.execute({ ...request, organizationId: consentIds.foreignOrganization }),
      () => f.status.execute({ ...command, organizationId: consentIds.foreignOrganization }),
      () => f.transition.execute({ ...command, organizationId: consentIds.foreignOrganization }),
    ])
      await expect(run()).rejects.toMatchObject({ status: 403 });
    expect(f.tickets.findById).not.toHaveBeenCalled();
    expect(f.consents.findById).not.toHaveBeenCalled();
  });
  it('rejects a foreign consent returned by a defective repository instead of exposing it', async () => {
    const { f, command, result } = await preparedConsent();
    const props = consentDataCopy(result.consent);
    Object.assign(props, { organizationId: consentIds.foreignOrganization });
    Object.assign(props.customerAuthority, { organizationId: consentIds.foreignOrganization });
    f.consents.findById.mockResolvedValue(CustomerConsentEntity.fromPersistence(props));
    await expect(f.status.execute(command)).rejects.toMatchObject({ status: 404 });
    await expect(f.transition.execute(command)).rejects.toMatchObject({ status: 404 });
    expect(f.consents.save).not.toHaveBeenCalled();
  });
  it.each(['projectionId', 'operation', 'environmentId'] as const)(
    'rejects mismatched status/decision scope %s',
    async (field) => {
      const { f, command } = await preparedConsent();
      const scope = {
        ...command.scope,
        [field]: field === 'operation' ? 'UC66_READ_LOGS' : 'another-proposed-scope',
      };
      await expect(f.status.execute({ ...command, scope })).rejects.toMatchObject({ status: 404 });
      await expect(f.transition.execute({ ...command, scope })).rejects.toMatchObject({
        status: 404,
      });
      expect(f.consents.save).not.toHaveBeenCalled();
    },
  );
  it('rejects purpose, Ticket revision and consent revision conflicts without overwriting history', async () => {
    const { f, command } = await preparedConsent();
    for (const patch of [
      { expectedTicketRevision: 1 },
      { expectedRevision: 1 },
      { scope: { ...command.scope, purposeId: 'different' } },
    ])
      await expect(f.transition.execute({ ...command, ...patch })).rejects.toMatchObject({
        status: 409,
      });
    expect(f.consents.save).not.toHaveBeenCalled();
    f.outcomes.next = 'CONFLICT';
    await expect(f.transition.execute(command)).rejects.toMatchObject({ status: 409 });
    expect(f.consents.save).toHaveBeenCalledTimes(1);
    expect(f.audits).toHaveLength(1);
  });
  it('never overwrites a repeated/conflicting source decision with another newly minted consent ID', async () => {
    const { f, request } = await preparedConsent();
    await expect(f.request.execute(request)).rejects.toMatchObject({ status: 409 });
    expect(f.records.size).toBe(1);
    expect(f.audits).toHaveLength(1);
  });
  it.each([false, true])(
    'preserves unconfirmed CREATE with possible fixture persistence=%s and never retries',
    async (persistUnknown) => {
      const f = consentApplicationFixture();
      f.outcomes.next = 'UNCONFIRMED';
      f.outcomes.persistUnknown = persistUnknown;
      const error = await f.request.execute(consentRequestCommand()).catch(
        (error: {
          status: number;
          response: {
            code: string;
            details: { consentId: string; retrySafe: boolean; mutationCommitted: string }[];
          };
        }) => error,
      );
      expect(error).toMatchObject({
        status: 503,
        response: {
          code: 'CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED',
          details: [expect.objectContaining({ retrySafe: false, mutationCommitted: 'unknown' })],
        },
      });
      expect(f.consents.create).toHaveBeenCalledTimes(1);
      expect(f.records.size).toBe(persistUnknown ? 1 : 0);
    },
  );
  it('maps thrown/unknown SAVE outcomes safely without retrying business work', async () => {
    const { f, command } = await preparedConsent();
    f.consents.save.mockRejectedValueOnce(new Error('SENSITIVE-provider-secret'));
    try {
      await f.transition.execute(command);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({
        status: 503,
        response: {
          code: 'CUSTOMER_CONSENT_OUTCOME_UNCONFIRMED',
          details: [
            expect.objectContaining({
              consentId: command.consentId,
              expectedRevision: 0,
              revision: 1,
              retrySafe: false,
            }),
          ],
        },
      });
      expect(JSON.stringify(error)).not.toContain('SENSITIVE-provider-secret');
    }
    expect(f.consents.save).toHaveBeenCalledTimes(1);
  });
  it('allows only one fixture CAS winner for competing refusal decisions', async () => {
    const { f, command } = await preparedConsent();
    const results = await Promise.allSettled([
      f.transition.execute(command),
      f.transition.execute({ ...command, source: consentSourceFixture('competing-refusal') }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(f.audits).toHaveLength(2);
  });
  it('does not treat an unavailable action as an operational access grant', async () => {
    const f = consentApplicationFixture();
    f.authority.authorize.mockRejectedValue(new ForbiddenException('unavailable'));
    await expect(f.request.execute(consentRequestCommand())).rejects.toMatchObject({ status: 503 });
    expect(f.records.size).toBe(0);
  });
  it.each([-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe revision %s before any authority or persistence access',
    async (revision) => {
      const f = consentApplicationFixture();
      await expect(
        f.request.execute({ ...consentRequestCommand(), expectedTicketRevision: revision }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        f.transition.execute({
          ...consentRequestCommand(),
          consentId: consentIds.consent,
          action: 'DECLINE',
          expectedRevision: revision,
          source: consentSourceFixture('refusal'),
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.authority.authorize).not.toHaveBeenCalled();
      expect(f.tickets.findById).not.toHaveBeenCalled();
    },
  );
  it('rejects disagreement between the request scope and proposed consent scope before authorization', async () => {
    const f = consentApplicationFixture(),
      input = consentRequestCommand();
    Object.assign(input.proposal.scope, { projectionId: 'different-proposal' });
    await expect(f.request.execute(input)).rejects.toMatchObject({ status: 400 });
    expect(f.authority.authorize).not.toHaveBeenCalled();
    expect(f.consents.create).not.toHaveBeenCalled();
  });
  it('does not publish a forged positive snapshot returned by a repository', async () => {
    const { f, command, result } = await preparedConsent();
    f.consents.findById.mockResolvedValue({
      toProps: () => ({ ...result.consent, state: 'VERIFIED_GRANTED' }),
    } as never);
    await expect(f.status.execute(command)).rejects.toMatchObject({
      status: 503,
      response: { code: 'CUSTOMER_CONSENT_SNAPSHOT_INVALID' },
    });
    await expect(f.transition.execute(command)).rejects.toMatchObject({ status: 503 });
    expect(f.consents.save).not.toHaveBeenCalled();
  });
  it('rejects replaying the request source as a refusal event without a second write', async () => {
    const { f, command } = await preparedConsent();
    await expect(
      f.transition.execute({ ...command, source: consentSourceFixture() }),
    ).rejects.toMatchObject({ status: 409, response: { code: 'CUSTOMER_CONSENT_EVENT_REUSED' } });
    expect(f.consents.save).not.toHaveBeenCalled();
    expect(f.audits).toHaveLength(1);
  });
});

describe('Customer Consent mutable-command regressions', () => {
  it('keeps REQUEST actor, scope, source, beneficiary, coverage and audit attribution across authorization waits', async () => {
    const f = consentApplicationFixture();
    const gate = deferred<ReturnType<typeof consentActorFixture>>();
    let captured!: Parameters<typeof consentActorFixture>[0];
    f.authority.authorize.mockImplementationOnce((request) => {
      captured = request;
      return gate.promise;
    });
    const input = consentRequestCommand();
    const operation = f.request.execute(input);
    // Wait until the explicit authority has received the captured immutable intent.
    for (let i = 0; !captured && i < 30; i++) await Promise.resolve();
    expect(captured).toBeDefined();
    Object.assign(input, {
      actorUserId: consentIds.beneficiary,
      organizationId: consentIds.foreignOrganization,
      episodeId: consentIds.nextEpisode,
    });
    Object.assign(input.scope, { purposeId: 'forged', projectionId: 'forged' });
    Object.assign(input.proposal.coverage, { personId: 'forged' });
    Object.assign(input.proposal.beneficiary.identity, { personId: 'forged' });
    Object.assign(input.source, { evidenceId: 'forged' });
    expect(Object.isFrozen(captured.proposal!.beneficiary.identity)).toBe(true);
    gate.resolve(consentActorFixture(captured));
    const result = await operation;
    expect(result.consent).toMatchObject({
      organizationId: consentIds.organization,
      episodeId: consentIds.episode,
      scope: { purposeId: 'diagnose', projectionId: 'proposed-projection-v1' },
      coverage: { personId: 'proposed-staff-person' },
      requestSource: { evidenceId: 'request-1' },
    });
    expect(f.audits[0].actorUserId).toBe(consentIds.actor);
    expect(f.audits[0].metadata!.sourceEventId).toBe('request-1');
  });
  it('keeps DECLINE identity/action/revision/source across authorization and persistence waits', async () => {
    const { f, command } = await preparedConsent();
    const gate = deferred<ReturnType<typeof consentActorFixture>>();
    let captured!: Parameters<typeof consentActorFixture>[0];
    f.authority.authorize.mockImplementationOnce((request) => {
      captured = request;
      return gate.promise;
    });
    const input = consentDataCopy(command);
    const operation = f.transition.execute(input);
    for (let i = 0; !captured && i < 30; i++) await Promise.resolve();
    Object.assign(input, {
      action: 'GRANT',
      actorUserId: consentIds.beneficiary,
      consentId: consentIds.ticket,
      expectedRevision: 99,
      organizationId: consentIds.foreignOrganization,
    });
    Object.assign(input.source, { evidenceId: 'forged' });
    gate.resolve(consentActorFixture(captured));
    const result = await operation;
    expect(result.consent).toMatchObject({
      consentId: command.consentId,
      state: 'DECLINED',
      revision: 1,
      updatedByUserId: consentIds.actor,
    });
    expect(f.consents.save.mock.calls[0][1]).toBe(0);
    expect(f.audits[1].metadata!.sourceEventId).toBe('refusal-1');
  });
  it('keeps STATUS scope/identity across an authorization wait', async () => {
    const { f, command } = await preparedConsent();
    const gate = deferred<ReturnType<typeof consentActorFixture>>();
    let captured!: Parameters<typeof consentActorFixture>[0];
    f.authority.authorize.mockImplementationOnce((request) => {
      captured = request;
      return gate.promise;
    });
    const input = consentDataCopy(command);
    const operation = f.status.execute(input);
    for (let i = 0; !captured && i < 30; i++) await Promise.resolve();
    Object.assign(input, {
      organizationId: consentIds.foreignOrganization,
      consentId: consentIds.ticket,
    });
    Object.assign(input.scope, { projectionId: 'forged' });
    gate.resolve(consentActorFixture(captured));
    expect(await operation).toMatchObject({
      consentId: command.consentId,
      organizationId: consentIds.organization,
      operationalAccess: false,
    });
    expect(f.consents.findById).toHaveBeenCalledWith(
      command.consentId,
      consentIds.organization,
      consentIds.ticket,
    );
  });
  it('keeps REQUEST snapshot and audit while the repository write awaits', async () => {
    const f = consentApplicationFixture(),
      input = consentRequestCommand();
    const gate = deferred<'CONFIRMED'>();
    f.consents.create.mockImplementationOnce(() => gate.promise);
    const operation = f.request.execute(input);
    for (let i = 0; f.consents.create.mock.calls.length === 0 && i < 50; i++)
      await Promise.resolve();
    expect(f.consents.create).toHaveBeenCalledTimes(1);
    Object.assign(input, {
      actorUserId: consentIds.beneficiary,
      organizationId: consentIds.foreignOrganization,
    });
    Object.assign(input.source, { evidenceId: 'forged-after-write' });
    const [written, audit] = f.consents.create.mock.calls[0];
    const originalCreatedAt = written.toProps().createdAt.getTime();
    const exposed = written.toProps();
    exposed.createdAt.setUTCFullYear(2000);
    Object.assign(exposed.scope, { projectionId: 'forged' });
    gate.resolve('CONFIRMED');
    const result = await operation;
    expect(result.consent).toMatchObject({
      organizationId: consentIds.organization,
      createdByUserId: consentIds.actor,
      requestSource: { evidenceId: 'request-1' },
    });
    expect(audit).toMatchObject({
      actorUserId: consentIds.actor,
      organizationId: consentIds.organization,
      metadata: { sourceEventId: 'request-1' },
    });
    expect(result.consent.createdAt.getTime()).toBe(originalCreatedAt);
  });
  it('keeps DECLINE snapshot, revision and audit while save awaits', async () => {
    const { f, command } = await preparedConsent();
    const gate = deferred<'CONFIRMED'>();
    f.consents.save.mockImplementationOnce(() => gate.promise);
    const input = consentDataCopy(command),
      operation = f.transition.execute(input);
    for (let i = 0; f.consents.save.mock.calls.length === 0 && i < 50; i++) await Promise.resolve();
    expect(f.consents.save).toHaveBeenCalledTimes(1);
    Object.assign(input, {
      action: 'GRANT',
      consentId: consentIds.ticket,
      expectedRevision: 99,
      actorUserId: consentIds.beneficiary,
    });
    Object.assign(input.source, { evidenceId: 'forged-after-save' });
    gate.resolve('CONFIRMED');
    const result = await operation;
    expect(result.consent).toMatchObject({
      consentId: command.consentId,
      state: 'DECLINED',
      revision: 1,
      updatedByUserId: consentIds.actor,
    });
    expect(f.consents.save.mock.calls[0][1]).toBe(0);
    expect(f.consents.save.mock.calls[0][2]).toMatchObject({
      actorUserId: consentIds.actor,
      metadata: { sourceEventId: 'refusal-1', expectedRevision: '0', revision: '1' },
    });
  });
  it('keeps STATUS binding while its repository read awaits', async () => {
    const { f, command, result } = await preparedConsent();
    const gate = deferred<CustomerConsentEntity | null>();
    f.consents.findById.mockImplementationOnce(() => gate.promise);
    const input = consentDataCopy(command),
      operation = f.status.execute(input);
    for (let i = 0; f.consents.findById.mock.calls.length === 0 && i < 50; i++)
      await Promise.resolve();
    Object.assign(input, {
      consentId: consentIds.ticket,
      episodeId: consentIds.nextEpisode,
      organizationId: consentIds.foreignOrganization,
    });
    gate.resolve(CustomerConsentEntity.fromPersistence(result.consent));
    expect(await operation).toMatchObject({
      consentId: command.consentId,
      episodeId: consentIds.episode,
      organizationId: consentIds.organization,
      operationalAccess: false,
    });
  });
});
