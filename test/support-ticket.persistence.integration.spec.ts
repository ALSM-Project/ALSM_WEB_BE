import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Connection, createConnection, Model, Types, mongo } from 'mongoose';
import { MongoAuditRepository } from '../src/modules/audit/infrastructure/mongo-audit.repository';
import { AuditLog, AuditLogSchema } from '../src/modules/audit/infrastructure/audit-log.schema';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import { MongoSupportTicketRepository } from '../src/modules/support/infrastructure/mongo-support-ticket.repository';
import { supportTicketToSnapshot } from '../src/modules/support/infrastructure/support-ticket.mapper';
import {
  SupportTicket,
  SupportTicketSchema,
} from '../src/modules/support/infrastructure/support-ticket.schema';
import {
  at,
  foreignId,
  historyTicket,
  newTicket,
  operatorId,
  organizationId,
  requesterId,
  retainedClaims,
} from './support-ticket.persistence.fixtures';
import { ticketRaceBarrier } from './support-ticket-race-barrier';

// Same reviewed loopback replica-set topology/ownership convention as Team/Sales.
// No .env, arbitrary URI, automatic service startup or access to application databases.
const owned =
  process.env.ALSM_SUPPORT_TICKET_TEST === 'owned-local-only' ? describe : describe.skip;
owned('Support Ticket persistence on the owned MongoDB replica set', () => {
  const runId = randomUUID().replaceAll('-', '');
  const database = `alsm_support_ticket_${runId}`;
  const uri = `mongodb://127.0.0.1:27127/${database}?replicaSet=alsmPriorities&directConnection=true`;
  let first: Connection,
    second: Connection,
    model: Model<SupportTicket>,
    auditModel: Model<AuditLog>;
  let repo: MongoSupportTicketRepository, competing: MongoSupportTicketRepository;
  let marked = false;
  const raceActors = { left: '555555555555555555555555', right: '666666666666666666666666' };

  function verifyContainer() {
    const [info] = JSON.parse(
      execFileSync('docker', ['inspect', 'alsm-priorities-20261017-mongo-rs'], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
    expect(info.State.Running).toBe(true);
    expect(info.Config.Labels['alsm.owner']).toBe('priorities-20261017');
    expect(info.NetworkSettings.Ports['27017/tcp']).toEqual([
      { HostIp: '127.0.0.1', HostPort: '27127' },
    ]);
  }
  function repository(connection: Connection) {
    const tickets = connection.model(SupportTicket.name, SupportTicketSchema);
    const audits = connection.model(AuditLog.name, AuditLogSchema);
    return new MongoSupportTicketRepository(tickets, (session, selectedConnection) =>
      new MongoAuditRepository(audits).inTransaction(session, selectedConnection),
    );
  }
  const auditCount = (ticketId: string) => auditModel.countDocuments({ resourceId: ticketId });

  async function assertWinningAudit(
    winner: SupportTicketEntity,
    loser: SupportTicketEntity,
    expectedRevision: number,
  ) {
    const winning = winner.toProps(),
      losing = loser.toProps();
    const winningEpisode = winning.episodes[winning.episodes.length - 1];
    const losingEpisode = losing.episodes[losing.episodes.length - 1];
    const actor = winning.status === 'OPEN' ? winningEpisode.openedBy : winningEpisode.endedBy!;
    const losingActor = losing.status === 'OPEN' ? losingEpisode.openedBy : losingEpisode.endedBy!;
    expect(actor).not.toBe(losingActor);
    expect(winning.revision).toBe(expectedRevision + 1);
    const entries = await auditModel
      .find({
        resourceId: winning.ticketId,
        'metadata.revision': String(winning.revision),
      })
      .lean()
      .exec();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    // ObjectId attribution and string metadata use the actual AuditLog schema.
    expect({
      actorUserId: String(entry.actorUserId),
      organizationId: String(entry.organizationId),
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      action: entry.action,
      metadata: entry.metadata,
    }).toEqual({
      actorUserId: actor,
      organizationId: winning.organizationId,
      resourceType: 'SUPPORT_TICKET',
      resourceId: winning.ticketId,
      action: `SUPPORT_TICKET_${winning.status === 'OPEN' ? 'REOPENED' : winning.status}`,
      metadata: {
        episodeId: winning.episodeId,
        expectedRevision: String(expectedRevision),
        revision: String(winning.revision),
        status: winning.status,
      },
    });
    expect(
      await auditModel.countDocuments({
        resourceId: winning.ticketId,
        actorUserId: new Types.ObjectId(losingActor),
      }),
    ).toBe(0);
  }

  async function overlappingWrites(
    ticketId: string,
    revision: number,
    left: () => Promise<boolean>,
    right: () => Promise<boolean>,
  ) {
    const barrier = ticketRaceBarrier({ ticketId, organizationId, revision });
    const failures: Record<'left' | 'right', unknown[]> = { left: [], right: [] };
    function intercept(connection: Connection, participant: 'left' | 'right') {
      const collection = connection.collection<SupportTicket>('support_tickets');
      const update = collection.updateOne.bind(collection);
      // Synchronization stays outside production; strict saves make one attempt.
      return jest
        .spyOn(collection, 'updateOne')
        .mockImplementationOnce(async (filter, change, options) => {
          try {
            const session = options?.session;
            if (!session) throw new Error(`Missing transaction session for ${participant}`);
            expect(filter).toMatchObject({ _id: ticketId, revision });
            const actual = await connection
              .model<SupportTicket>(SupportTicket.name)
              .findOne({ _id: ticketId, organizationId: filter.organizationId })
              .session(session)
              .lean()
              .exec();
            if (!actual) throw new Error(`Missing scoped Ticket for ${participant}`);
            // This read is in the SAME snapshot transaction that save() validated.
            await barrier.arrive({
              participant,
              session,
              ticketId: String(actual._id),
              organizationId: String(actual.organizationId),
              revision: actual.revision,
            });
            return await update(filter, change, options);
          } catch (error) {
            failures[participant].push(error);
            throw error;
          }
        });
    }
    const leftSpy = intercept(first, 'left'),
      rightSpy = intercept(second, 'right');
    try {
      const outcomes = await Promise.allSettled([left(), right()]);
      barrier.assertReady(); // Includes the original bounded timeout diagnostic.
      expect(leftSpy).toHaveBeenCalledTimes(1);
      expect(rightSpy).toHaveBeenCalledTimes(1);
      const observations = barrier.observations();
      expect(observations).toHaveLength(2);
      expect(observations[0].session).not.toBe(observations[1].session);
      for (const observation of observations)
        expect(observation).toMatchObject({ ticketId, organizationId, revision });
      const results = outcomes.map((outcome, index) => {
        if (outcome.status === 'fulfilled') return outcome.value;
        const error = outcome.reason as { getResponse?: () => { code?: string } };
        const code = error.getResponse?.().code;
        // Uncertainty is never accepted as an ordinary losing CAS operation.
        if (code === 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED') throw outcome.reason;
        expect(code).toBe('ATOMIC_MUTATION_ABORTED');
        const participant = index === 0 ? 'left' : 'right';
        expect(
          failures[participant].some((failure) => {
            const driver = failure as { code?: number; hasErrorLabel?: (label: string) => boolean };
            return (
              driver.hasErrorLabel?.('UnknownTransactionCommitResult') !== true &&
              (driver.code === 112 || driver.hasErrorLabel?.('TransientTransactionError') === true)
            );
          }),
        ).toBe(true);
        return false;
      });
      expect([...results].sort()).toEqual([false, true]);
      return results;
    } finally {
      barrier.cancel();
      leftSpy.mockRestore();
      rightSpy.mockRestore();
    }
  }

  beforeAll(async () => {
    verifyContainer();
    first = await createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 10000,
    }).asPromise();
    expect((await first.db!.admin().command({ hello: 1 })).setName).toBe('alsmPriorities');
    expect(await first.db!.listCollections().toArray()).toHaveLength(0);
    await first.collection('_support_ticket_test_owner').insertOne({ runId, database });
    marked = true;
    model = first.model(SupportTicket.name, SupportTicketSchema);
    auditModel = first.model(AuditLog.name, AuditLogSchema);
    await model.createCollection();
    await auditModel.createCollection();
    second = await createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000,
      timeoutMS: 10000,
    }).asPromise();
    repo = repository(first);
    competing = repository(second);
  }, 20000);
  afterAll(async () => {
    try {
      if (first && marked) {
        verifyContainer();
        expect(first.name).toBe(database);
        expect(
          await first.collection('_support_ticket_test_owner').findOne({ runId, database }),
        ).toBeTruthy();
        await first.dropDatabase();
      }
    } finally {
      if (second) await second.close();
      if (first) await first.close();
    }
  });

  it('creates insert-only Tickets with attributed audit and a real unique _id_ fence', async () => {
    const ticket = newTicket(),
      props = ticket.toProps();
    await repo.create(ticket);
    expect((await model.collection.indexes()).find((index) => index.name === '_id_')?.key).toEqual({
      _id: 1,
    });
    await expect(repo.create(ticket)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_ALREADY_EXISTS' },
    });
    const foreign = SupportTicketEntity.createNew({
      ticketId: props.ticketId,
      organizationId: foreignId,
      requesterUserId: foreignId,
      purposeId: props.purposeId,
      episodeId: randomUUID(),
      now: at(0),
    });
    await expect(repo.create(foreign)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_ALREADY_EXISTS' },
    });
    expect((await repo.findById(props.ticketId, organizationId))!.toProps()).toEqual(props);
    expect(await auditCount(props.ticketId)).toBe(1);
    const audit = await auditModel.findOne({ resourceId: props.ticketId }).lean();
    expect(String(audit!.actorUserId)).toBe(requesterId);
    expect(String(audit!.organizationId)).toBe(organizationId);
  });

  it('does not read or write a Ticket through another Organisation scope', async () => {
    const ticket = newTicket(),
      props = ticket.toProps();
    await repo.create(ticket);
    expect(await repo.findById(props.ticketId, foreignId)).toBeNull();
    const foreign = SupportTicketEntity.fromPersistence({ ...props, organizationId: foreignId });
    foreign.close(operatorId, at(1));
    expect(await repo.save(foreign, 0)).toBe(false);
    expect((await repo.findById(props.ticketId, organizationId))!.toProps()).toEqual(props);
    expect(await auditCount(props.ticketId)).toBe(1);
  });

  it('allows one committed CLOSE/CANCEL winner at the same expected revision across two connections', async () => {
    const original = newTicket(),
      id = original.toProps().ticketId;
    await repo.create(original);
    // Explicit legacy fixture only: prove a real retained consent/approval pair
    // is cleared by the winning race, without adding an attachment API.
    await first.collection<SupportTicket>('support_tickets').updateOne(
      { _id: id },
      {
        $set: {
          decisionReferences: supportTicketToSnapshot(retainedClaims(original)).decisionReferences,
        },
      },
    );
    const close = (await repo.findById(id, organizationId))!,
      cancel = (await competing.findById(id, organizationId))!;
    expect(close.toProps().decisionReferences?.customerConsent).toBeDefined();
    expect(close.toProps().decisionReferences?.internalApproval).toBeDefined();
    close.close(raceActors.left, at(1));
    cancel.cancel(raceActors.right, at(1));
    const results = await overlappingWrites(
      id,
      0,
      () => repo.save(close, 0),
      () => competing.save(cancel, 0),
    );
    expect([...results].sort()).toEqual([false, true]);
    expect((await repo.findById(id, organizationId))!.toProps()).toEqual(
      (results[0] ? close : cancel).toProps(),
    );
    expect(await auditCount(id)).toBe(2);
    const final = (await repo.findById(id, organizationId))!.toProps();
    expect(final.episodes).toHaveLength(1);
    expect(final.decisionReferences).toBeNull();
    await assertWinningAudit(results[0] ? close : cancel, results[0] ? cancel : close, 0);
  }, 20000);

  it('allows one committed REOPEN winner, preserving the terminal episode and clearing claims', async () => {
    const original = newTicket(),
      id = original.toProps().ticketId;
    await repo.create(original);
    original.close(operatorId, at(1));
    expect(await repo.save(original, 0)).toBe(true);
    const left = (await repo.findById(id, organizationId))!,
      right = (await competing.findById(id, organizationId))!;
    left.reopen(raceActors.left, at(2), randomUUID());
    right.reopen(raceActors.right, at(2), randomUUID());
    const results = await overlappingWrites(
      id,
      1,
      () => repo.save(left, 1),
      () => competing.save(right, 1),
    );
    expect([...results].sort()).toEqual([false, true]);
    const stored = (await repo.findById(id, organizationId))!.toProps();
    expect(stored).toEqual((results[0] ? left : right).toProps());
    expect(stored.episodes[0]).toEqual(original.toProps().episodes[0]);
    expect(stored.decisionReferences).toBeNull();
    expect(await auditCount(id)).toBe(3);
    expect(stored.episodes).toHaveLength(2);
    await assertWinningAudit(results[0] ? left : right, results[0] ? right : left, 1);
  }, 20000);

  it.each(['CLOSED', 'CANCELLED'] as const)(
    'atomically clears retained unverified claims when %s',
    async (status) => {
      // Explicit legacy/corruption fixture insertion only, not a reference-attachment API.
      const ticket = retainedClaims(),
        id = ticket.toProps().ticketId;
      await first
        .collection<SupportTicket>('support_tickets')
        .insertOne(supportTicketToSnapshot(ticket));
      const loaded = (await repo.findById(id, organizationId))!;
      if (status === 'CLOSED') loaded.close(operatorId, at(1));
      else loaded.cancel(operatorId, at(1));
      expect(await repo.save(loaded, 0)).toBe(true);
      const raw = await first.collection<SupportTicket>('support_tickets').findOne({ _id: id });
      expect(raw).toMatchObject({ status, revision: 1, decisionReferences: null });
      loaded.reopen(operatorId, at(2), randomUUID());
      expect(await repo.save(loaded, 1)).toBe(true);
      expect((await repo.findById(id, organizationId))!.toProps().decisionReferences).toBeNull();
      expect(await auditCount(id)).toBe(2);
    },
  );

  it.each(['requesterUserId', 'purposeId', 'createdAt'] as const)(
    'rejects immutable %s changes without state/audit writes',
    async (field) => {
      const ticket = newTicket(),
        initial = ticket.toProps();
      await repo.create(ticket);
      ticket.close(operatorId, at(1));
      const props = ticket.toProps();
      const episodes =
        field === 'requesterUserId'
          ? props.episodes.map((e) => ({ ...e, openedBy: foreignId }))
          : field === 'createdAt'
            ? props.episodes.map((e) => ({ ...e, openedAt: at(-1) }))
            : props.episodes;
      const changed = SupportTicketEntity.fromPersistence({
        ...props,
        [field]: field === 'createdAt' ? at(-1) : foreignId,
        episodes,
      });
      await expect(repo.save(changed, 0)).rejects.toMatchObject({
        response: { code: 'SUPPORT_TICKET_IMMUTABLE_FIELDS' },
      });
      expect((await repo.findById(initial.ticketId, organizationId))!.toProps()).toEqual(initial);
      expect(await auditCount(initial.ticketId)).toBe(1);
    },
  );

  it.each(['revision', 'truncated', 'duplicate', 'ordering', 'missing'] as const)(
    'rejects raw malformed %s history without repairing it',
    async (kind) => {
      const snapshot = supportTicketToSnapshot(historyTicket('CLOSED'));
      if (kind === 'revision') snapshot.revision = 0;
      if (kind === 'truncated') snapshot.episodes.splice(1, 1);
      if (kind === 'duplicate') snapshot.episodes[1] = snapshot.episodes[0];
      if (kind === 'ordering') snapshot.episodes[1] = { ...snapshot.episodes[1], openedAt: at(0) };
      if (kind === 'missing') Reflect.deleteProperty(snapshot, 'decisionReferences');
      await first.collection<SupportTicket>('support_tickets').insertOne(snapshot);
      await expect(repo.findById(snapshot._id, organizationId)).rejects.toMatchObject({
        response: { code: 'SUPPORT_TICKET_SNAPSHOT_INVALID' },
      });
      expect(
        await first.collection<SupportTicket>('support_tickets').findOne({ _id: snapshot._id }),
      ).toEqual(snapshot);
      expect(await auditCount(snapshot._id)).toBe(0);
    },
  );

  it('prevents a replacement history from recycling an episode ID held in persisted history', async () => {
    const ticket = historyTicket('CLOSED'),
      before = ticket.toProps();
    await first
      .collection<SupportTicket>('support_tickets')
      .insertOne(supportTicketToSnapshot(ticket));
    const changed = SupportTicketEntity.fromPersistence({
      ...before,
      episodes: before.episodes.map((e, i) => (i === 1 ? { ...e, episodeId: 'replacement' } : e)),
    });
    changed.reopen(operatorId, at(6), before.episodes[1].episodeId);
    await expect(repo.save(changed, 5)).rejects.toMatchObject({
      response: { code: 'SUPPORT_TICKET_EPISODE_REUSED' },
    });
    expect((await repo.findById(before.ticketId, organizationId))!.toProps()).toEqual(before);
  });

  it.each(['create', 'save'] as const)(
    'rolls back both %s and an audit append that fails after insertion',
    async (operation) => {
      const ticket = newTicket(),
        before = ticket.toProps();
      if (operation === 'save') await repo.create(ticket);
      const failing = new MongoSupportTicketRepository(model, (session, connection) => ({
        async append(entry) {
          await new MongoAuditRepository(auditModel)
            .inTransaction(session, connection)
            .append(entry);
          throw new Error('TEST audit failure after append');
        },
      }));
      if (operation === 'save') ticket.close(operatorId, at(1));
      await expect(
        operation === 'create' ? failing.create(ticket) : failing.save(ticket, 0),
      ).rejects.toMatchObject({ response: { code: 'ATOMIC_MUTATION_ABORTED' } });
      expect((await repo.findById(before.ticketId, organizationId))?.toProps() ?? null).toEqual(
        operation === 'create' ? null : before,
      );
      expect(await auditCount(before.ticketId)).toBe(operation === 'create' ? 0 : 1);
    },
  );

  it('returns detached snapshots whose local mutations cannot affect MongoDB', async () => {
    const ticket = newTicket(),
      before = ticket.toProps();
    await repo.create(ticket);
    const loaded = (await repo.findById(before.ticketId, organizationId))!;
    loaded.close(operatorId, at(1));
    const props = loaded.toProps();
    props.createdAt.setUTCFullYear(2000);
    expect((await repo.findById(before.ticketId, organizationId))!.toProps()).toEqual(before);
  });

  it('reports injected client acknowledgement loss after a real commit as unknown, without replaying the write', async () => {
    const ticket = newTicket(),
      id = ticket.toProps().ticketId;
    const session = await first.startSession();
    const actual = session.commitTransaction.bind(session);
    const cause = new mongo.MongoServerError({
      message: 'TEST acknowledgement lost after a real commit',
      code: 50,
      errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
    });
    const sessionSpy = jest.spyOn(first, 'startSession').mockResolvedValueOnce(session);
    const startSpy = jest.spyOn(session, 'startTransaction');
    const writeSpy = jest.spyOn(first.collection<SupportTicket>('support_tickets'), 'insertOne');
    const commitSpy = jest
      .spyOn(session, 'commitTransaction')
      .mockImplementationOnce(async (options) => {
        await actual(options);
        throw cause;
      });
    try {
      await expect(repo.create(ticket)).rejects.toMatchObject({
        cause,
        response: { code: 'SUPPORT_TICKET_OUTCOME_UNCONFIRMED' },
      });
      expect(sessionSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(writeSpy).toHaveBeenCalledTimes(1);
      expect(commitSpy).toHaveBeenCalledTimes(1);
      expect((await repo.findById(id, organizationId))!.toProps()).toEqual(ticket.toProps());
      expect(await auditCount(id)).toBe(1);
    } finally {
      sessionSpy.mockRestore();
      startSpy.mockRestore();
      writeSpy.mockRestore();
      commitSpy.mockRestore();
    }
  });
});
