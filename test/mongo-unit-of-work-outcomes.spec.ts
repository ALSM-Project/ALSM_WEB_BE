import { Connection, mongo } from 'mongoose';
import type { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { MongoSalesUnitOfWork } from '../src/modules/crm/infrastructure/mongo-sales-unit-of-work';
import { MongoTeamUnitOfWork } from '../src/modules/teams/infrastructure/mongo-team-unit-of-work';

/** Shared-caller regression fixture only; no database atomicity claim. */
function fixture(kind: 'Team' | 'Sales') {
  let active = false;
  const control = { commitError: undefined as mongo.MongoServerError | undefined };
  const session = {
    explicit: true,
    hasEnded: false,
    transaction: {},
    inTransaction: () => active,
    withTransaction: jest.fn(async (work: () => Promise<unknown>) => {
      active = true;
      try {
        const result = await work();
        if (control.commitError) throw control.commitError;
        return result;
      } finally {
        active = false;
      }
    }),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    db: { admin: () => ({ command: async () => ({ setName: 'fixture' }) }) },
    startSession: jest.fn().mockResolvedValue(session),
  };
  const scoped = {},
    secondScoped = {};
  const participant = { inTransaction: jest.fn().mockReturnValue(scoped) };
  const secondParticipant = { inTransaction: jest.fn().mockReturnValue(secondScoped) };
  const audit: jest.Mocked<AuditRepository> = { append: jest.fn().mockResolvedValue(undefined) };
  const auditFactory = jest.fn(() => audit);
  const connectionPort = connection as unknown as Connection;
  const run = (work: (repositories: { audit: AuditRepository }) => Promise<string>) =>
    kind === 'Team'
      ? new MongoTeamUnitOfWork(
          connectionPort,
          participant as unknown as ConstructorParameters<typeof MongoTeamUnitOfWork>[1],
          secondParticipant as unknown as ConstructorParameters<typeof MongoTeamUnitOfWork>[2],
          auditFactory,
        ).run(work, 'stable-id')
      : new MongoSalesUnitOfWork(
          connectionPort,
          participant as unknown as ConstructorParameters<typeof MongoSalesUnitOfWork>[1],
          () => secondScoped as ReturnType<ConstructorParameters<typeof MongoSalesUnitOfWork>[2]>,
          auditFactory,
        ).run(work, 'stable-id');
  return { run, control, session, connection, participant, audit, auditFactory };
}

describe.each(['Team', 'Sales'] as const)('shared transaction runner caller: %s', (kind) => {
  it('retains same-session participant/audit binding and successful return values', async () => {
    const f = fixture(kind);
    const result = await f.run(async ({ audit }) => {
      await audit.append({ action: 'TEST', resourceType: 'TEST', resourceId: 'stable-id' });
      return 'committed';
    });
    expect(result).toBe('committed');
    expect(f.participant.inTransaction).toHaveBeenCalledWith(f.session, f.connection);
    expect(f.auditFactory).toHaveBeenCalledWith(f.session, f.connection);
    expect(f.audit.append).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    'does not replay simulated committed work for code 11000 + unknown outcome (transient=%s)',
    async (transient) => {
      const f = fixture(kind);
      f.control.commitError = new mongo.MongoServerError({
        message: 'TEST unconfirmed commit',
        code: 11000,
        errorLabels: [
          'UnknownTransactionCommitResult',
          ...(transient ? ['TransientTransactionError'] : []),
        ],
      });
      const work = jest.fn(async ({ audit }: { audit: AuditRepository }) => {
        await audit.append({ action: 'TEST', resourceType: 'TEST', resourceId: 'stable-id' });
        return 'potentially committed';
      });
      await expect(f.run(work)).rejects.toMatchObject({
        response: {
          code: 'TEAM_MUTATION_OUTCOME_UNCONFIRMED',
          details: [{ mutationCommitted: 'unknown', retrySafe: false }],
        },
      });
      expect(work).toHaveBeenCalledTimes(1);
      expect(f.session.withTransaction).toHaveBeenCalledTimes(1);
      expect(f.audit.append).toHaveBeenCalledTimes(1);
      expect(f.session.endSession).toHaveBeenCalledTimes(1);
    },
  );
});
