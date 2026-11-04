import {
  otherSupportOrganizationId,
  supportOrganizationId,
  uc66Fixture,
} from './uc66-foundation.fixtures';

describe('UC66-01/02 use-case orchestration (not database atomicity evidence)', () => {
  it('uses persisted session/role authority and returns only safe search metadata', async () => {
    const f = uc66Fixture();
    f.organizations.search.mockResolvedValueOnce([
      {
        id: supportOrganizationId,
        name: 'Customer',
        type: 'SELF_SERVICE',
        status: 'ACTIVE',
        contactEmail: 'private@example.test',
        members: ['private'],
      },
    ] as never);
    const response = await f.search.execute(f.origin, {
      query: 'Customer',
      field: 'name',
      limit: 10,
    });
    expect(response.items[0]).toEqual({
      id: supportOrganizationId,
      name: 'Customer',
      type: 'SELF_SERVICE',
      status: 'ACTIVE',
    });
    expect(f.authority.current).toHaveBeenCalledWith(f.origin.userId, expect.any(Date));
  });

  it.each([0, 26, 100000, NaN])('rejects an unbounded search limit %s', async (limit) => {
    const f = uc66Fixture();
    await expect(
      f.search.execute(f.origin, { query: 'Customer', field: 'name', limit }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.organizations.search).not.toHaveBeenCalled();
  });

  it.each(['', '  ', 'ab', 'Cust\nomer', 'x'.repeat(121)])(
    'rejects invalid query %j',
    async (query) => {
      const f = uc66Fixture();
      await expect(
        f.search.execute(f.origin, { query, field: 'name', limit: 10 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.organizations.search).not.toHaveBeenCalled();
    },
  );

  it('denies missing authority even with forged Admin/permission claims', async () => {
    const f = uc66Fixture();
    f.authority.current.mockResolvedValueOnce(null as never);
    await expect(
      f.search.execute(
        {
          ...f.origin,
          isPlatformAdmin: true,
          roles: ['INTERNAL_SUPPORT'],
          permissions: ['organizations.impersonate'],
        } as typeof f.origin,
        { query: 'Customer', field: 'name', limit: 10 },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.organizations.search).not.toHaveBeenCalled();
  });

  it('fails closed when staff authority storage is unavailable', async () => {
    const f = uc66Fixture();
    f.authority.current.mockRejectedValueOnce(new Error('private driver details'));
    await expect(f.enter.execute(f.origin, supportOrganizationId)).rejects.toMatchObject({
      status: 503,
      response: { code: 'SUPPORT_ACCESS_UNAVAILABLE' },
    });
    expect(f.rows.size).toBe(0);
  });

  it('does not disclose search results if staff authority is lost while the query is in flight', async () => {
    const f = uc66Fixture();
    f.authority.current
      .mockResolvedValueOnce({ binding: 'a'.repeat(64) })
      .mockResolvedValueOnce(null as never);
    await expect(
      f.search.execute(f.origin, { query: 'Customer', field: 'name', limit: 10 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('creates a scoped context with real actor and original session, without customer credentials', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      p = c.toProps();
    expect(p).toMatchObject({
      actorUserId: f.origin.userId,
      originalSessionId: f.origin.sessionId,
      organizationId: supportOrganizationId,
      readOnly: true,
      audience: 'UC66',
      state: 'ACTIVE',
    });
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]).toMatchObject({
      actorUserId: f.origin.userId,
      organizationId: supportOrganizationId,
      action: 'SUPPORT_CONTEXT_ENTERED',
      resourceId: p.id,
    });
    expect(p).not.toHaveProperty('accessToken');
  });

  it('rejects duplicate Enter in the same origin and exposes its own context for reconciliation', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    await expect(f.enter.execute(f.origin, supportOrganizationId)).rejects.toMatchObject({
      status: 409,
      response: {
        code: 'SUPPORT_CONTEXT_ALREADY_ACTIVE',
        details: [{ contextId: c.toProps().id }],
      },
    });
    expect(f.rows.size).toBe(1);
    expect(f.audits).toHaveLength(1);
  });

  it('rejects absent or ineligible Organisations', async () => {
    const f = uc66Fixture();
    await expect(f.enter.execute(f.origin, otherSupportOrganizationId)).rejects.toMatchObject({
      status: 404,
    });
    expect(f.rows.size).toBe(0);
    expect(f.audits).toHaveLength(0);
  });

  it('does not confirm Enter when its required audit fails', async () => {
    const f = uc66Fixture();
    f.control.failAudit = true;
    await expect(f.enter.execute(f.origin, supportOrganizationId)).rejects.toThrow(
      'TEST audit failure',
    );
    expect(f.rows.size).toBe(0);
    expect(f.audits).toHaveLength(0);
  });

  it('rejects cross-Organisation use without refreshing idle time', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      before = f.rows.get(c.toProps().id);
    f.control.time += 60000;
    await expect(
      f.reads.execute(f.origin, otherSupportOrganizationId, c.toProps().id, 'CONTEXT_STATUS'),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.rows.get(c.toProps().id)).toEqual(before);
    expect(f.audits).toHaveLength(1);
  });

  it.each([
    'PROJECT_READ',
    'PROJECT_WRITE',
    'GET_EXPORT',
    'MAPPING',
    'RETRY',
    'BILLING',
    'CONTEXT_STATUS_WRITE',
  ])('denies unreviewed operation %s regardless of HTTP verb', async (operation) => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      before = f.rows.get(c.toProps().id);
    await expect(
      f.reads.execute(f.origin, supportOrganizationId, c.toProps().id, operation),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.rows.get(c.toProps().id)).toEqual(before);
    expect(f.audits).toHaveLength(1);
  });

  it('successful, audited activity refreshes idle time within the absolute cap', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId);
    f.control.time += 14 * 60000;
    const touched = await f.reads.execute(
      f.origin,
      supportOrganizationId,
      c.toProps().id,
      'CONTEXT_STATUS',
    );
    expect(touched.toProps().lastActivityAt.getTime()).toBe(f.control.time);
    expect(touched.toProps().expiresAt).toEqual(c.toProps().expiresAt);
    expect(f.audits[1].action).toBe('SUPPORT_CONTEXT_READ');
  });

  it('failed activity audit does not refresh idle time', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      before = f.rows.get(c.toProps().id);
    f.control.time += 60000;
    f.control.failAudit = true;
    await expect(
      f.reads.execute(f.origin, supportOrganizationId, c.toProps().id, 'CONTEXT_STATUS'),
    ).rejects.toThrow('TEST audit failure');
    expect(f.rows.get(c.toProps().id)).toEqual(before);
    expect(f.audits).toHaveLength(1);
  });

  it('authority lost during an authorized activity rolls back its pending idle update and audit', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      id = c.toProps().id,
      before = f.rows.get(id);
    f.control.time += 60000;
    f.authority.current
      .mockResolvedValueOnce({ binding: 'a'.repeat(64) })
      .mockResolvedValueOnce({ binding: 'a'.repeat(64) })
      .mockResolvedValueOnce(null as never);
    await expect(
      f.reads.execute(f.origin, supportOrganizationId, id, 'CONTEXT_STATUS'),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.rows.get(id)).toEqual(before);
    expect(f.audits).toHaveLength(1);
  });

  it('Exit revokes immediately; repeated Exit has one audit and cannot be reused', async () => {
    const f = uc66Fixture(),
      c = await f.enter.execute(f.origin, supportOrganizationId),
      id = c.toProps().id;
    await f.exit.execute(f.origin, supportOrganizationId, id);
    await f.exit.execute(f.origin, supportOrganizationId, id);
    expect(f.rows.get(id)?.state).toBe('EXITED');
    expect(f.audits.filter((a) => a.action === 'SUPPORT_CONTEXT_EXITED')).toHaveLength(1);
    await expect(
      f.reads.execute(f.origin, supportOrganizationId, id, 'CONTEXT_STATUS'),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each(['revoked', 'locked', 'inactive', 'version', 'role', 'regrant'])(
    'denies context reuse after %s',
    async (state) => {
      const f = uc66Fixture(),
        c = await f.enter.execute(f.origin, supportOrganizationId),
        id = c.toProps().id,
        before = f.rows.get(id);
      if (state === 'revoked') f.session.revokedAt = new Date();
      if (state === 'locked') f.account.isLocked = true;
      if (state === 'inactive') f.account.isActive = false;
      if (state === 'version') f.session.accessVersion = 'different';
      if (state === 'role') f.authority.current.mockResolvedValue(null as never);
      if (state === 'regrant') f.authority.current.mockResolvedValue({ binding: 'b'.repeat(64) });
      await expect(
        f.reads.execute(f.origin, supportOrganizationId, id, 'CONTEXT_STATUS'),
      ).rejects.toMatchObject({ status: ['role', 'regrant'].includes(state) ? 403 : 401 });
      expect(f.rows.get(id)).toEqual(before);
      expect(f.audits).toHaveLength(1);
    },
  );

  it.each([15, 31])(
    'requires a new explicit Enter after %s minutes of inactivity',
    async (minutes) => {
      const f = uc66Fixture(),
        c = await f.enter.execute(f.origin, supportOrganizationId),
        id = c.toProps().id;
      f.control.time += minutes * 60000;
      await expect(
        f.reads.execute(f.origin, supportOrganizationId, id, 'CONTEXT_STATUS'),
      ).rejects.toMatchObject({ status: 409 });
      const next = await f.enter.execute(f.origin, supportOrganizationId);
      expect(next.toProps().id).not.toBe(id);
      expect(f.rows.get(id)?.state).toBe('EXPIRED');
    },
  );
});
