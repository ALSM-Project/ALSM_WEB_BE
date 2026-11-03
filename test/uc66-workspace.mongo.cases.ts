import { INestApplication } from '@nestjs/common';
import { Connection, Model, Types, mongo } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const request = require('supertest');
import { AuditLog } from '../src/modules/audit/infrastructure/audit-log.schema';
import { TRANSACTIONAL_AUDIT_FACTORY } from '../src/modules/audit/domain/transactional-audit.port';
import { SUPPORT_ORGANIZATION_DIRECTORY } from '../src/modules/organizations/domain/support-organization-directory.port';
import { SUPPORT_PROJECT_READER } from '../src/modules/projects/application/support-project-reader.port';
import { SUPPORT_SCREEN_READER } from '../src/modules/screens/application/support-screen-reader.port';
import { SUPPORT_CONVERSION_READER } from '../src/modules/conversions/application/support-conversion-reader.port';
import { SUPPORT_FINDING_READER } from '../src/modules/validation/application/support-finding-reader.port';
import { DiagnosticReaderFactory } from '../src/shared/application/diagnostic-read.port';
import {
  ReadSupportWorkspaceService,
  SUPPORT_WORKSPACE_OPERATIONS,
  SupportWorkspaceKind,
} from '../src/modules/support/application/read-support-workspace.service';
import { SupportStaffAccessService } from '../src/modules/support/application/support-staff-access.service';
import { SUPPORT_INSPECTION } from '../src/modules/support/application/support-inspection.port';
import { ExitSupportContextService } from '../src/modules/support/application/exit-support-context.service';
import { SupportClock } from '../src/modules/support/application/support-context.ports';
import { MongoSupportContextUnitOfWork } from '../src/modules/support/infrastructure/mongo-support-context.unit-of-work';
import { SupportContextSnapshot } from '../src/modules/support/infrastructure/support-context.schema';
import {
  supportUserId,
  supportSessionId,
  supportOrganizationId,
  otherSupportOrganizationId,
} from './uc66-foundation.fixtures';

interface Fixture {
  app: INestApplication;
  connection: Connection;
  external: Connection;
  contexts: Model<SupportContextSnapshot>;
  audits: Model<AuditLog>;
  clock: SupportClock;
  control: { time: number };
  enter(): Promise<string>;
  token(): string;
  fault(error: () => Error): {
    counts: { businessCallbacks: number; commitCalls: number };
    restore(): void;
  };
}
/** Registered inside the existing ownership-checked real Mongo fixture. */
export function registerUc66WorkspaceMongoCases(getFixture: () => Fixture) {
  describe('UC66-03 workspace projections with real persisted authority, resources and audit', () => {
    const ids = {
      project: 'aaaaaaaaaaaaaaaaaaaaaaa1',
      otherProject: 'aaaaaaaaaaaaaaaaaaaaaaa2',
      screen: 'bbbbbbbbbbbbbbbbbbbbbbb1',
      program: 'bbbbbbbbbbbbbbbbbbbbbbb2',
      job: 'ccccccccccccccccccccccc1',
      run: 'ddddddddddddddddddddddd1',
      finding: 'eeeeeeeeeeeeeeeeeeeeeee1',
      error: 'fffffffffffffffffffffff1',
    };
    const secret = 'PRIVATE_SOURCE_PASSWORD_ACCESS_TOKEN';
    const kinds = Object.keys(SUPPORT_WORKSPACE_OPERATIONS) as SupportWorkspaceKind[];
    const resourceIds = {
      projects: ids.project,
      screens: ids.screen,
      programs: ids.program,
      findings: ids.finding,
      'conversion-logs': ids.job,
      'error-logs': ids.error,
    };
    const oid = (id: string) => new Types.ObjectId(id);
    let f: Fixture;
    const contextPath = (id: string, org = supportOrganizationId) =>
      `/api/v1/support/organizations/${org}/contexts/${id}`;
    const path = (
      id: string,
      kind: SupportWorkspaceKind = 'projects',
      detail = false,
      projectId = ids.project,
    ) =>
      `${contextPath(id)}/workspace/projects${kind === 'projects' ? (detail ? `/${projectId}` : '') : `/${projectId}/${kind}${detail ? `/${resourceIds[kind]}` : ''}`}`;
    const get = (url: string) =>
      request(f.app.getHttpServer()).get(url).set('Authorization', `Bearer ${f.token()}`);
    const collection = (name: string) => f.connection.collection(name);
    const readEvents = (id: string) =>
      f.audits.countDocuments({ action: 'SUPPORT_WORKSPACE_READ', 'metadata.contextId': id });
    const revoke = async (state: string) => {
      if (state === 'role')
        await f.external.collection('user_roles').deleteMany({ userId: supportUserId });
      if (state === 'session')
        await f.external
          .collection('user_sessions')
          .updateOne({ _id: oid(supportSessionId) }, { $set: { revokedAt: new Date() } });
      if (state === 'account')
        await f.external
          .collection('users')
          .updateOne({ _id: oid(supportUserId) }, { $set: { isActive: false } });
    };
    beforeEach(async () => {
      f = getFixture();
      for (const name of [
        'projects',
        'screens',
        'conversion_jobs',
        'validation_runs',
        'validation_findings',
        'error_logs',
      ])
        await collection(name).deleteMany({});
      const scope = {
        organizationId: oid(supportOrganizationId),
        projectId: oid(ids.project),
        createdAt: new Date(f.control.time),
        updatedAt: new Date(f.control.time),
      };
      await collection('projects').insertMany([
        {
          _id: oid(ids.project),
          ...scope,
          name: 'Customer Project',
          status: 'ACTIVE',
          conversionType: 'COBOL_TO_JAVA',
          description: secret,
          deletedAt: null,
        },
        {
          _id: oid(ids.otherProject),
          organizationId: oid(otherSupportOrganizationId),
          name: 'Other private project',
          status: 'ACTIVE',
        },
      ]);
      await collection('screens').insertMany([
        {
          _id: oid(ids.screen),
          ...scope,
          name: 'BMS Screen',
          sourceType: 'BMS',
          status: 'READY',
          inputReference: secret,
          content: secret,
          sizeBytes: 100,
          dependencies: [{ content: secret }],
        },
        {
          _id: oid(ids.program),
          ...scope,
          name: 'COBOL Program',
          sourceType: 'COBOL',
          status: 'READY',
          inputReference: secret,
          content: secret,
          dependencyStatus: 'BLOCKED',
        },
      ]);
      await collection('conversion_jobs').insertOne({
        _id: oid(ids.job),
        ...scope,
        screenId: ids.program,
        status: 'FAILED',
        conversionType: 'COBOL_TO_JAVA',
        attemptCount: 1,
        maxAttempts: 3,
        processingToken: secret,
        errorMessage: secret,
        inputReference: secret,
        resultReference: secret,
      });
      await collection('validation_runs').insertOne({
        _id: oid(ids.run),
        ...scope,
        conversionJobId: oid(ids.job),
        screenId: ids.program,
        status: 'COMPLETED',
        failureMessage: secret,
      });
      await collection('validation_findings').insertOne({
        _id: oid(ids.finding),
        ...scope,
        conversionJobId: oid(ids.job),
        validationRunId: oid(ids.run),
        screenId: ids.program,
        source: 'RULE',
        category: 'LOGIC_MISMATCH',
        severity: 'HIGH',
        status: 'PENDING',
        confidence: 0.5,
        title: secret,
        explanation: secret,
        sourceLocation: { snippet: secret },
        fingerprint: secret,
      });
      await collection('error_logs').insertOne({
        _id: oid(ids.error),
        ...scope,
        severity: 'ERROR',
        status: 'UNRESOLVED',
        lineNumber: 5,
        errorCode: secret,
        offendingCode: secret,
        suggestedPatch: { offendingLine: secret, suggestedLine: secret },
        screenName: secret,
      });
    });

    it.each(kinds)(
      'reads bounded %s metadata and individual details without raw secrets or resource mutation',
      async (kind) => {
        const id = await f.enter();
        f.control.time += 1000;
        const before = await collection('screens').find({}).sort({ _id: 1 }).toArray();
        const list = await get(path(id, kind));
        expect(list.status).toBe(200);
        expect(list.headers['cache-control']).toBe('no-store');
        expect(list.body.operationId).toMatch(/^[a-f0-9-]{36}$/);
        expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([resourceIds[kind]]);
        expect(list.body.nextAfterId).toBeNull();
        const detail = await get(path(id, kind, true));
        expect(detail.status).toBe(200);
        expect(detail.body.item.id).toBe(resourceIds[kind]);
        expect(JSON.stringify([list.body, detail.body])).not.toContain(secret);
        expect(await collection('screens').find({}).sort({ _id: 1 }).toArray()).toEqual(before);
        const events = await f.audits
          .find({ action: 'SUPPORT_WORKSPACE_READ' })
          .sort({ _id: 1 })
          .lean();
        expect(events).toHaveLength(2);
        expect(events[1]).toMatchObject({
          actorUserId: oid(supportUserId),
          organizationId: oid(supportOrganizationId),
          resourceId: resourceIds[kind],
          metadata: {
            contextId: id,
            originalSessionId: supportSessionId,
            operationId: detail.body.operationId,
            operation: SUPPORT_WORKSPACE_OPERATIONS[kind][1],
            returnedResourceIds: resourceIds[kind],
            mode: 'READ_ONLY',
          },
        });
        expect(events[1].createdAt).toBeInstanceOf(Date);
        expect((await f.contexts.findById(id).lean())!).toMatchObject({
          revision: 3,
          lastActivityAt: new Date(f.control.time),
        });
      },
    );
    it('derives legacy Screen and Finding ownership through validated parent records', async () => {
      await collection('screens').updateOne(
        { _id: oid(ids.screen) },
        { $unset: { organizationId: '' }, $set: { projectId: ids.project } },
      );
      await collection('validation_findings').updateOne(
        { _id: oid(ids.finding) },
        { $unset: { organizationId: '' } },
      );
      const id = await f.enter();
      expect((await get(path(id, 'screens', true))).status).toBe(200);
      expect((await get(path(id, 'findings', true))).status).toBe(200);
    });
    it.each([
      'screen-org',
      'child-project',
      'finding-org',
      'run-org',
      'run-job',
      'job-org',
      'deleted-project',
    ])('fails closed on inconsistent nested ownership: %s', async (state) => {
      const id = await f.enter();
      if (state === 'screen-org')
        await collection('screens').updateOne(
          { _id: oid(ids.screen) },
          { $set: { organizationId: oid(otherSupportOrganizationId) } },
        );
      if (state === 'child-project')
        await collection('screens').updateOne(
          { _id: oid(ids.screen) },
          { $set: { projectId: oid(ids.otherProject) } },
        );
      if (state === 'finding-org')
        await collection('validation_findings').updateOne(
          { _id: oid(ids.finding) },
          { $set: { organizationId: oid(otherSupportOrganizationId) } },
        );
      if (state === 'run-org')
        await collection('validation_runs').updateOne(
          { _id: oid(ids.run) },
          { $set: { organizationId: oid(otherSupportOrganizationId) } },
        );
      if (state === 'run-job')
        await collection('validation_runs').updateOne(
          { _id: oid(ids.run) },
          { $set: { conversionJobId: new Types.ObjectId() } },
        );
      if (state === 'job-org')
        await collection('conversion_jobs').updateOne(
          { _id: oid(ids.job) },
          { $set: { organizationId: oid(otherSupportOrganizationId) } },
        );
      if (state === 'deleted-project')
        await collection('projects').updateOne(
          { _id: oid(ids.project) },
          { $set: { deletedAt: new Date() } },
        );
      const response = await get(
        path(id, ['screen-org', 'child-project'].includes(state) ? 'screens' : 'findings', true),
      );
      expect(response.status).toBe(404);
      expect(await readEvents(id)).toBe(0);
      expect((await f.contexts.findById(id).lean())!.revision).toBe(1);
    });
    it.each(kinds)('denies cross-Organisation/project substitution for %s', async (kind) => {
      const id = await f.enter();
      expect((await get(path(id, kind, true, ids.otherProject))).status).toBe(404);
      expect(
        (await get(path(id, kind).replace(supportOrganizationId, otherSupportOrganizationId)))
          .status,
      ).toBe(404);
      expect(await readEvents(id)).toBe(0);
    });
    it.each(['screens', 'programs', 'conversion-logs', 'error-logs'] as const)(
      'denies an explicitly foreign %s row under an otherwise valid parent',
      async (kind) => {
        const id = await f.enter();
        const name = ['screens', 'programs'].includes(kind)
          ? 'screens'
          : kind === 'conversion-logs'
            ? 'conversion_jobs'
            : 'error_logs';
        await collection(name).updateOne(
          { _id: oid(resourceIds[kind]) },
          { $set: { organizationId: oid(otherSupportOrganizationId) } },
        );
        expect((await get(path(id, kind, true))).status).toBe(404);
        expect(await readEvents(id)).toBe(0);
        expect((await f.contexts.findById(id).lean())!.revision).toBe(1);
      },
    );

    it('bounds keyset pagination and excludes deleted/foreign rows', async () => {
      const id = await f.enter();
      await collection('projects').insertMany(
        Array.from({ length: 27 }, (_, index) => ({
          _id: new Types.ObjectId(),
          organizationId: oid(supportOrganizationId),
          name: `Project ${index}`,
          status: 'ACTIVE',
          conversionType: 'COBOL_TO_JAVA',
          deletedAt: index === 26 ? new Date() : null,
        })),
      );
      const first = await get(`${path(id)}?limit=25`);
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(25);
      expect(first.body.nextAfterId).toBe(first.body.items[24].id);
      const second = await get(`${path(id)}?limit=25&afterId=${first.body.nextAfterId}`);
      expect(second.status).toBe(200);
      expect(second.body.items).toHaveLength(2);
      expect(second.body.nextAfterId).toBeNull();
      expect(
        new Set([...first.body.items, ...second.body.items].map((item: { id: string }) => item.id))
          .size,
      ).toBe(27);
      for (const query of [
        'limit=0',
        'limit=26',
        'limit=1.5',
        'afterId=forged',
        'query=.*',
        'readOnly=false',
        'operation=GET_EXPORT',
      ])
        expect((await get(`${path(id)}?${query}`)).status).toBe(400);
      expect(await readEvents(id)).toBe(2);
    });
    it('denies missing/malformed IDs, invalid kind and a Program requested as Screen', async () => {
      const id = await f.enter();
      for (const url of [
        `${path(id)}/forged`,
        `${path(id)}/${new Types.ObjectId()}`,
        path(id, 'screens', true).replace(ids.screen, ids.program),
        path(id, 'screens').replace('/screens', '/exports'),
      ])
        expect([400, 404]).toContain((await get(url)).status);
      expect(await readEvents(id)).toBe(0);
    });
    it.each(['idle', 'absolute', 'exit'])(
      'denies %s contexts without resource activity',
      async (state) => {
        const id = await f.enter();
        if (state === 'exit')
          await request(f.app.getHttpServer())
            .post(`${contextPath(id)}/exit`)
            .set('Authorization', `Bearer ${f.token()}`)
            .send({});
        else f.control.time += (state === 'idle' ? 15 : 30) * 60000;
        expect((await get(path(id))).status).toBe(409);
        expect(await readEvents(id)).toBe(0);
      },
    );
    it.each(['role', 'session', 'account'])(
      'denies revoked %s and unauthenticated reads without refreshing idle',
      async (state) => {
        const id = await f.enter();
        await revoke(state);
        expect([401, 403]).toContain((await get(path(id))).status);
        expect((await request(f.app.getHttpServer()).get(path(id))).status).toBe(401);
        expect(await readEvents(id)).toBe(0);
        expect((await f.contexts.findById(id).lean())!.revision).toBe(1);
      },
    );
    it('rejects write and side-effect GET routes without touching customer resources', async () => {
      const id = await f.enter();
      const before = await collection('screens').find({}).toArray();
      for (const method of ['post', 'put', 'patch', 'delete']) {
        const response = await request(f.app.getHttpServer())
          [method](path(id, 'screens', true))
          .set('Authorization', `Bearer ${f.token()}`)
          .send({ readOnly: false, content: secret });
        expect([404, 405]).toContain(response.status);
      }
      for (const action of [
        'upload',
        'convert',
        'retry',
        'mapping',
        'generate',
        'export',
        'download',
        'billing',
      ])
        expect([400, 404]).toContain((await get(`${path(id, 'screens', true)}/${action}`)).status);
      expect(await collection('screens').find({}).toArray()).toEqual(before);
      expect(await readEvents(id)).toBe(0);
    });
    it('replaces corrupt categorical payloads with UNKNOWN and never leaks error/source fields', async () => {
      const id = await f.enter();
      await collection('screens').updateOne({ _id: oid(ids.screen) }, { $set: { status: secret } });
      const response = await get(path(id, 'screens', true));
      expect(response.status).toBe(200);
      expect(response.body.item.status).toBe('UNKNOWN');
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect((await collection('screens').findOne({ _id: oid(ids.screen) }))!.status).toBe(secret);
    });
    it('rolls activity back when the real audit validator rejects the required resource-read event', async () => {
      const id = await f.enter(),
        before = (await f.contexts.findById(id).lean())!;
      f.control.time += 1000;
      await f.connection.db!.command({
        collMod: 'audit_logs',
        validator: { action: { $ne: 'SUPPORT_WORKSPACE_READ' } },
        validationAction: 'error',
      });
      expect((await get(path(id, 'findings', true))).status).toBe(503);
      const after = (await f.contexts.findById(id).lean())!;
      expect(after.revision).toBe(before.revision);
      expect(after.lastActivityAt).toEqual(before.lastActivityAt);
      expect(await readEvents(id)).toBe(0);
    });
    it('serializes local resource reads and Exit without reactivation or orphan audit', async () => {
      const id = await f.enter();
      f.control.time += 1000;
      const responses = await Promise.all([
        get(path(id)),
        get(path(id, 'programs')),
        request(f.app.getHttpServer())
          .post(`${contextPath(id)}/exit`)
          .set('Authorization', `Bearer ${f.token()}`)
          .send({}),
        get(path(id, 'findings')),
      ]);
      expect(responses[2].status).toBe(200);
      for (const response of [responses[0], responses[1], responses[3]])
        expect([200, 409, 503]).toContain(response.status);
      expect((await f.contexts.findById(id).lean())!.state).toBe('EXITED');
      expect(await readEvents(id)).toBe(
        [responses[0], responses[1], responses[3]].filter(
          (r) => r.status === 200 || r.body.code === 'SUPPORT_WORKSPACE_DELIVERY_WITHHELD',
        ).length,
      );
      expect((await get(path(id))).status).toBe(409);
    });
    it('fences a resource read against Exit committed by an independent adapter instance', async () => {
      const id = await f.enter(),
        factory = f.app.get<DiagnosticReaderFactory>(SUPPORT_PROJECT_READER),
        bind = factory.bind.bind(factory);
      let signal!: () => void, release!: () => void;
      const projected = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = jest.spyOn(factory, 'bind').mockImplementation((handle) => {
        const reader = bind(handle);
        return {
          read: async (query) => {
            const rows = await reader.read(query);
            signal();
            await gate;
            return rows;
          },
        };
      });
      try {
        const reading = Promise.resolve(get(path(id)));
        await projected;
        const otherExit = new ExitSupportContextService(
          f.app.get(SupportStaffAccessService),
          new MongoSupportContextUnitOfWork(
            f.connection,
            f.contexts,
            f.app.get(TRANSACTIONAL_AUDIT_FACTORY),
          ),
          f.clock,
        );
        try {
          await otherExit.execute(
            {
              userId: supportUserId,
              sessionId: supportSessionId,
              sessionVersion: 'original-generation',
            },
            supportOrganizationId,
            id,
          );
        } finally {
          release();
        }
        expect((await reading).status).toBe(409);
        expect((await f.contexts.findById(id).lean())!).toMatchObject({
          state: 'EXITED',
          revision: 2,
        });
        expect(await readEvents(id)).toBe(0);
      } finally {
        release();
        spy.mockRestore();
      }
    });

    it('aborts one competing cross-instance resource read without replay or orphan audit', async () => {
      const id = await f.enter(),
        factory = f.app.get<DiagnosticReaderFactory>(SUPPORT_PROJECT_READER),
        bind = factory.bind.bind(factory);
      let arrived = 0,
        release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const spy = jest.spyOn(factory, 'bind').mockImplementation((handle) => {
        const reader = bind(handle);
        return {
          read: async (query) => {
            const rows = await reader.read(query);
            if (!query.id) {
              if (++arrived === 2) release();
              await barrier;
            }
            return rows;
          },
        };
      });
      try {
        const other = new ReadSupportWorkspaceService(
          f.app.get(SupportStaffAccessService),
          f.app.get(SUPPORT_ORGANIZATION_DIRECTORY),
          new MongoSupportContextUnitOfWork(
            f.connection,
            f.contexts,
            f.app.get(TRANSACTIONAL_AUDIT_FACTORY),
          ),
          f.clock,
          factory,
          f.app.get(SUPPORT_SCREEN_READER),
          f.app.get(SUPPORT_CONVERSION_READER),
          f.app.get(SUPPORT_FINDING_READER),
          f.app.get(SUPPORT_INSPECTION),
        );
        const input = {
          organizationId: supportOrganizationId,
          contextId: id,
          kind: 'projects' as const,
        };
        const actor = {
          userId: supportUserId,
          sessionId: supportSessionId,
          sessionVersion: 'original-generation',
        };
        const outcomes = await Promise.allSettled([
          f.app
            .get(ReadSupportWorkspaceService)
            .execute(actor, input, SUPPORT_WORKSPACE_OPERATIONS.projects[0]),
          other.execute(actor, input, SUPPORT_WORKSPACE_OPERATIONS.projects[0]),
        ]);
        expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(outcomes.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { status: 409 },
        });
        expect(arrived).toBe(2);
        expect(await readEvents(id)).toBe(1);
        expect((await f.contexts.findById(id).lean())!.revision).toBe(2);
      } finally {
        spy.mockRestore();
      }
    });
    it.each([
      { code: 50, errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'] },
      {
        writeConcernError: { code: 50 },
        errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
      },
      {
        code: 64,
        writeConcernError: { code: 50 },
        errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'],
      },
      { code: 11000, errorLabels: ['UnknownTransactionCommitResult', 'TransientTransactionError'] },
      { code: 50, errorLabels: ['UnknownTransactionCommitResult'] },
      { code: 50, errorLabels: [] },
    ])('keeps actual workspace commit unconfirmed without replay: %j', async (body) => {
      const id = await f.enter();
      f.control.time += 1000;
      const fault = f.fault(
        () =>
          new mongo.MongoServerError({ message: 'TEST workspace acknowledgement loss', ...body }),
      );
      try {
        const response = await get(path(id));
        expect(response.status).toBe(503);
        expect(response.body).toMatchObject({
          code: 'SUPPORT_CONTEXT_OUTCOME_UNCONFIRMED',
          details: [{ contextId: id, mutationCommitted: 'unknown', retrySafe: false }],
        });
        expect(response.body).not.toHaveProperty('items');
        expect(fault.counts).toEqual({ businessCallbacks: 1, commitCalls: 1 });
        const event = await f.audits
          .findOne({
            action: 'SUPPORT_WORKSPACE_READ',
            'metadata.operationId': response.body.details[0].operationId,
          })
          .lean();
        expect(event).toMatchObject({
          actorUserId: oid(supportUserId),
          organizationId: oid(supportOrganizationId),
          metadata: { contextId: id, returnedResourceIds: ids.project },
        });
        expect(await readEvents(id)).toBe(1);
        expect((await f.contexts.findById(id).lean())!.revision).toBe(2);
      } finally {
        fault.restore();
      }
    });
    it.each(['role', 'session', 'account'])(
      'rolls back when external %s revocation occurs during projection',
      async (state) => {
        const id = await f.enter(),
          factory = f.app.get<DiagnosticReaderFactory>(SUPPORT_PROJECT_READER),
          bind = factory.bind.bind(factory);
        const spy = jest.spyOn(factory, 'bind').mockImplementation((handle) => {
          const reader = bind(handle);
          return {
            read: async (query) => {
              const rows = await reader.read(query);
              await revoke(state);
              return rows;
            },
          };
        });
        try {
          const response = await get(path(id));
          expect([401, 403]).toContain(response.status);
          expect(await readEvents(id)).toBe(0);
          expect((await f.contexts.findById(id).lean())!.revision).toBe(1);
        } finally {
          spy.mockRestore();
        }
      },
    );

    it.each(['role', 'session', 'account'])(
      'withholds data when external %s revocation races after the final pre-commit check',
      async (state) => {
        const id = await f.enter(),
          start = f.connection.startSession.bind(f.connection);
        const spy = jest
          .spyOn(f.connection, 'startSession')
          .mockImplementationOnce(async (options) => {
            const session = await start(options),
              commit = session.commitTransaction.bind(session);
            session.commitTransaction = async (...args) => {
              await revoke(state);
              await commit(...args);
            };
            return session;
          });
        try {
          const response = await get(path(id));
          expect(response.status).toBe(403);
          expect(response.body).toMatchObject({
            code: 'SUPPORT_WORKSPACE_DELIVERY_WITHHELD',
            details: [{ contextId: id, activityCommitted: true, retrySafe: false }],
          });
          expect(response.body).not.toHaveProperty('items');
          expect(await readEvents(id)).toBe(1);
          expect((await f.contexts.findById(id).lean())!.revision).toBe(2);
        } finally {
          spy.mockRestore();
        }
      },
    );
    it.each(['role', 'session', 'account'])(
      'documents the approved bounded external %s revocation window after its final authority observation',
      async (state) => {
        const id = await f.enter(),
          access = f.app.get(SupportStaffAccessService),
          check = access.recheck.bind(access);
        let checks = 0;
        const spy = jest.spyOn(access, 'recheck').mockImplementation(async (...args) => {
          await check(...args);
          if (++checks === 4) await revoke(state);
        });
        try {
          // The authority loss occurs after this request's last live observation.
          // It denies the next request; this is the approved bounded policy, not
          // a claim that all global revocation commands share a transaction epoch.
          const response = await get(path(id));
          expect(response.status).toBe(200);
          expect(checks).toBe(4);
          expect([401, 403]).toContain((await get(path(id))).status);
          expect(await readEvents(id)).toBe(1);
        } finally {
          spy.mockRestore();
        }
      },
    );
  });
}
