import { ServiceUnavailableException } from '@nestjs/common';
import {
  ReadSupportWorkspaceService,
  SUPPORT_WORKSPACE_OPERATIONS,
  SupportWorkspaceKind,
} from '../src/modules/support/application/read-support-workspace.service';
import { SupportContextUnitOfWork } from '../src/modules/support/application/support-context.ports';
import { SupportContextEntity } from '../src/modules/support/domain/support-context.entity';
import {
  uc66Fixture,
  supportOrganizationId,
  otherSupportOrganizationId,
} from './uc66-foundation.fixtures';

function fixture() {
  const f = uc66Fixture();
  const reader = {
    read: jest.fn(async () => [{ view: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Safe label' } }]),
  };
  const factory = { bind: jest.fn(() => reader) };
  const transactions: SupportContextUnitOfWork = {
    run: (id, work) =>
      f.transactions.run(id, (ports) =>
        work({ ...ports, readTransaction: { session: {}, connection: {} } }),
      ),
  };
  const service = new ReadSupportWorkspaceService(
    f.access,
    f.organizations,
    transactions,
    f.clock,
    factory,
    factory,
    factory,
    factory,
    {
      scoped: async (scope) => {
        const row = f.rows.get(scope.id);
        return row ? SupportContextEntity.fromPersistence(row) : null;
      },
      latest: async () => null,
      snapshot: (work) => work({ session: {}, connection: {} }),
    },
  );
  const read = (contextId: string, kind: SupportWorkspaceKind = 'projects', extra = {}) =>
    service.execute(
      f.origin,
      {
        organizationId: supportOrganizationId,
        contextId,
        kind,
        ...(kind !== 'projects' ? { projectId: 'bbbbbbbbbbbbbbbbbbbbbbbb' } : {}),
        ...extra,
      },
      SUPPORT_WORKSPACE_OPERATIONS[kind][0],
    );
  return { ...f, reader, factory, transactions, service, read };
}

describe('UC66-03 workspace orchestration (Mongo suite separately proves atomicity)', () => {
  it.each(Object.keys(SUPPORT_WORKSPACE_OPERATIONS) as SupportWorkspaceKind[])(
    'authorizes and audits the explicit %s list',
    async (kind) => {
      const f = fixture(),
        context = await f.enter.execute(f.origin, supportOrganizationId);
      f.control.time += 1000;
      const result = await f.read(context.toProps().id, kind);
      expect(result).toHaveProperty('items', [
        { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Safe label' },
      ]);
      expect(f.audits.at(-1)).toMatchObject({
        action: 'SUPPORT_WORKSPACE_READ',
        actorUserId: f.origin.userId,
        organizationId: supportOrganizationId,
        metadata: {
          contextId: context.toProps().id,
          originalSessionId: f.origin.sessionId,
          operation: SUPPORT_WORKSPACE_OPERATIONS[kind][0],
          returnedResourceIds: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        },
      });
      expect(f.rows.get(context.toProps().id)!.revision).toBe(2);
    },
  );
  it.each([
    'PROJECT_WRITE',
    'GET_EXPORT',
    'RETRY_CONVERSION',
    'WORKSPACE_PROJECT_DETAIL',
    '__proto__',
  ])('rejects non-matching operation %s before reading', async (operation) => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    await expect(
      f.service.execute(
        f.origin,
        { organizationId: supportOrganizationId, contextId: c.toProps().id, kind: 'projects' },
        operation,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.reader.read).not.toHaveBeenCalled();
  });
  it.each([0, 26, 1.5, NaN])('rejects unbounded limit %s without activity', async (limit) => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    await expect(f.read(c.toProps().id, 'projects', { limit })).rejects.toMatchObject({
      status: 400,
    });
    expect(f.rows.get(c.toProps().id)!.revision).toBe(1);
  });
  it('denies another Organisation without calling a projection port', async () => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    await expect(
      f.read(c.toProps().id, 'projects', { organizationId: otherSupportOrganizationId }),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.reader.read).not.toHaveBeenCalled();
  });
  it('does not read a child when its parent is unavailable', async () => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    f.reader.read.mockResolvedValueOnce([]);
    await expect(f.read(c.toProps().id, 'screens')).rejects.toMatchObject({ status: 404 });
    expect(f.reader.read).toHaveBeenCalledTimes(1);
  });
  it('rolls pending activity back when authority disappears during a projection', async () => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    f.reader.read.mockImplementationOnce(async () => {
      f.authority.current.mockResolvedValue(null as never);
      return [{ view: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Safe label' } }];
    });
    await expect(f.read(c.toProps().id)).rejects.toMatchObject({ status: 403 });
    expect(f.rows.get(c.toProps().id)!.revision).toBe(1);
    expect(f.audits).toHaveLength(1);
  });
  it('withholds delivery after post-commit revocation and reports the committed activity accurately', async () => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      run = f.transactions.run.bind(f.transactions);
    f.transactions.run = async (id, work) => {
      const result = await run(id, work);
      f.account.isActive = false;
      return result;
    };
    await expect(f.read(c.toProps().id)).rejects.toMatchObject({
      status: 403,
      response: {
        code: 'SUPPORT_WORKSPACE_DELIVERY_WITHHELD',
        details: [{ contextId: c.toProps().id, activityCommitted: true, retrySafe: false }],
      },
    });
    expect(f.rows.get(c.toProps().id)!.revision).toBe(2);
    expect(f.audits.at(-1)!.action).toBe('SUPPORT_WORKSPACE_READ');
  });
  it('passes uncertain commit identity through without replay or response data', async () => {
    const f = fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      run = f.transactions.run.bind(f.transactions);
    const invocation = jest.fn(run);
    f.transactions.run = async (id, work) => {
      await invocation(id, work);
      throw new ServiceUnavailableException({
        code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
        details: [{ contextId: id, mutationCommitted: 'unknown', retrySafe: false }],
      });
    };
    await expect(f.read(c.toProps().id)).rejects.toMatchObject({
      status: 503,
      response: {
        code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
        details: [{ contextId: c.toProps().id, mutationCommitted: 'unknown', retrySafe: false }],
      },
    });
    expect(invocation).toHaveBeenCalledTimes(1);
    // Original projection plus one fresh ownership validation, without callback replay.
    expect(f.reader.read).toHaveBeenCalledTimes(2);
    expect(f.rows.get(c.toProps().id)!.revision).toBe(2);
  });
});
