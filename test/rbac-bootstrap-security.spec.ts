import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as bcrypt from 'bcrypt';
import { environmentValidationSchema } from '../src/config/environment.validation';
import { AUDIT_REPOSITORY } from '../src/modules/audit/domain/audit.repository';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { RbacSeedService } from '../src/modules/rbac/application/rbac-seed.service';
import { RbacService } from '../src/modules/rbac/application/rbac.service';
import {
  IPermission,
  IRole,
  IRbacRepository,
  RBAC_REPOSITORY,
} from '../src/modules/rbac/domain/rbac.repository.interface';
import { RbacModule } from '../src/modules/rbac/rbac.module';

jest.mock('bcrypt', () => ({ hash: jest.fn() }));

const historicalEmails = [
  'admin@alsm.io',
  'teamlead@alsm.io',
  'sales@alsm.io',
  'sales_staff@alsm.io',
  'support@alsm.io',
  'converter@alsm.io',
  'enterprise@company.com',
  'partner@fintechnexus.io',
  'staff@alsm.io',
  'partner@alsm.io',
  'enterprise@alsm.io',
];
const modelNames = [
  'Role',
  'Permission',
  'RolePermission',
  'UserRole',
  'User',
  'MenuItem',
  'MenuItemPermission',
  'TemporaryRole',
];
const environmentKeys = ['NODE_ENV', 'ENABLE_SEED', 'ALSM_ENABLE_DEV_TEST_ACCOUNTS', 'MONGODB_URI'];

// These dependencies are never invoked by startup; HTTP/session behavior has separate real-guard tests.
@Global()
@Module({
  providers: [
    { provide: JwtService, useValue: {} },
    { provide: ConfigService, useValue: {} },
    { provide: RequireCurrentSessionService, useValue: {} },
    { provide: AUDIT_REPOSITORY, useValue: { append: jest.fn() } },
  ],
  exports: [JwtService, ConfigService, RequireCurrentSessionService, AUDIT_REPOSITORY],
})
class StartupDependenciesModule {}

function fixture(accounts: Array<Record<string, unknown>> = []) {
  const roles = new Map<string, IRole>();
  const permissions = new Map<string, IPermission>();
  const grants = new Map<string, string[]>();
  const forbidden = () => {
    throw new Error('Startup attempted identity persistence');
  };
  const identityModel = {
    findOne: jest.fn((query: { email: string }) => ({
      exec: async () => accounts.find((account) => account.email === query.email) ?? null,
    })),
    find: jest.fn(forbidden),
    findById: jest.fn(forbidden),
    create: jest.fn(forbidden),
    updateOne: jest.fn(forbidden),
    updateMany: jest.fn(forbidden),
    findOneAndUpdate: jest.fn(forbidden),
    insertMany: jest.fn(forbidden),
    deleteMany: jest.fn(forbidden),
  };
  const repo: Partial<IRbacRepository> = {
    findRoleById: jest.fn(async (id: string) => roles.get(id) ?? null),
    findRoles: jest.fn(async () => [...roles.values()]),
    createRole: jest.fn(async (role: IRole) => {
      roles.set(role.id, { ...role });
      return role;
    }),
    findPermissionByKey: jest.fn(async (key: string) => permissions.get(key) ?? null),
    findPermissions: jest.fn(async () => [...permissions.values()]),
    createPermission: jest.fn(async (permission: IPermission) => {
      permissions.set(permission.key, { ...permission });
      return permission;
    }),
    updatePermission: jest.fn(async (key, data) => {
      const current = permissions.get(key);
      if (!current) return null;
      const updated = { ...current, ...data };
      permissions.set(key, updated);
      return updated;
    }),
    findRolePermissions: jest.fn(async (id: string) => [...(grants.get(id) ?? [])]),
    findAllRolePermissions: jest.fn(async () =>
      [...grants].flatMap(([roleId, keys]) =>
        keys.map((permissionKey) => ({ roleId, permissionKey })),
      ),
    ),
    findValidPermissions: jest.fn(async (keys: string[]) =>
      keys.filter((key) => permissions.has(key)),
    ),
    updateRolePermissions: jest.fn(async (id: string, keys: string[]) => {
      grants.set(id, [...keys]);
      return keys;
    }),
    findUserById: jest.fn(forbidden),
    findAllUsers: jest.fn(forbidden),
    findUserRoles: jest.fn(forbidden),
    updateUserRoles: jest.fn(forbidden),
    findAllUserRoles: jest.fn(forbidden),
  };
  const roleModel = {
    findOne: jest.fn((query: { $or: Array<{ id: string }> }) => ({
      exec: async () => roles.get(query.$or[0].id) ?? null,
    })),
    updateOne: jest.fn(forbidden),
  };
  async function compile() {
    let builder = Test.createTestingModule({ imports: [StartupDependenciesModule, RbacModule] })
      .overrideProvider(RBAC_REPOSITORY)
      .useValue(repo);
    for (const name of modelNames) {
      builder = builder
        .overrideProvider(getModelToken(name))
        .useValue(name === 'Role' ? roleModel : identityModel);
    }
    return builder.compile();
  }
  function expectNoIdentityAccess() {
    for (const method of Object.values(identityModel)) expect(method).not.toHaveBeenCalled();
    for (const name of [
      'findUserById',
      'findAllUsers',
      'findUserRoles',
      'updateUserRoles',
      'findAllUserRoles',
    ] as const)
      expect(repo[name]).not.toHaveBeenCalled();
    expect(bcrypt.hash).not.toHaveBeenCalled();
  }
  return { roles, permissions, grants, repo, roleModel, compile, expectNoIdentityAccess };
}

describe('catalogue-only RBAC startup security', () => {
  let previousEnvironment: Record<string, string | undefined>;
  beforeEach(() => {
    previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.clearAllMocks();
  });
  afterEach(() => {
    for (const key of environmentKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    jest.restoreAllMocks();
  });

  const environments = ['production', 'staging', 'development', 'test', undefined, 'unknown'];
  it.each(
    environments.flatMap((environment) =>
      [false, true].map((enabled) => ({ environment, enabled })),
    ),
  )(
    'never provisions accounts for $environment, opt-in=$enabled, even with a local target',
    async ({ environment, enabled }) => {
      if (environment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = environment;
      process.env.ENABLE_SEED = String(enabled);
      process.env.ALSM_ENABLE_DEV_TEST_ACCOUNTS = String(enabled);
      process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/alsm_disposable_test';
      const f = fixture();
      const app = (await f.compile()).createNestApplication({ logger: false });
      try {
        await app.init();
        expect(f.roles.size).toBe(10);
        expect(f.permissions.has('resources.transfer.confirm')).toBe(true);
        expect(f.grants.get('SYSTEM_ADMIN')).toContain('organizations.view');
        f.expectNoIdentityAccess();
      } finally {
        await app.close();
      }
    },
  );

  it.each(['', 'TRUE', '1', 'yes', 'false ', 'null'])(
    'cannot enable identity bootstrap using malformed flag %j or a shared database',
    async (flag) => {
      process.env.NODE_ENV = 'development';
      process.env.ALSM_ENABLE_DEV_TEST_ACCOUNTS = flag;
      process.env.MONGODB_URI = 'mongodb+srv://shared.example.test/alsm';
      const f = fixture();
      const context = await f.compile();
      try {
        await context.init();
        f.expectNoIdentityAccess();
      } finally {
        await context.close();
      }
    },
  );

  it('keeps development startup catalogue-only when both seed flags are missing', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ENABLE_SEED;
    delete process.env.ALSM_ENABLE_DEV_TEST_ACCOUNTS;
    const f = fixture();
    const context = await f.compile();
    try {
      await context.init();
      f.expectNoIdentityAccess();
    } finally {
      await context.close();
    }
  });

  it('does not disable or change a pre-existing active Platform Admin', async () => {
    const account = {
      email: 'admin@alsm.io',
      isPlatformAdmin: true,
      isActive: true,
      isEmailVerified: true,
      isLocked: false,
      roles: ['OWNER_DEFINED_ROLE'],
      passwordHash: randomBytes(32).toString('hex'),
    };
    const before = structuredClone(account);
    const f = fixture([account]);
    const context = await f.compile();
    try {
      await context.init();
      expect(account).toEqual(before);
      f.expectNoIdentityAccess();
    } finally {
      await context.close();
    }
  });

  it.each(historicalEmails)(
    'preserves all account and session state for historical identity %s',
    async (email) => {
      const account = {
        email,
        passwordHash: randomBytes(32).toString('hex'),
        isActive: false,
        isEmailVerified: false,
        isPlatformAdmin: false,
        isLocked: true,
        lockReason: 'Owner decision',
        mustChangePassword: true,
        mfa: { enabled: true, secret: randomBytes(32).toString('hex'), backupCodeHashes: [] },
        roles: ['CUSTOM_REVIEWER'],
        credentialVersion: randomBytes(16).toString('hex'),
        session: { accessVersion: randomBytes(16).toString('hex'), revokedAt: new Date() },
      };
      const before = structuredClone(account);
      const f = fixture([account]);
      const context = await f.compile();
      try {
        await context.init();
        await context.get(RbacSeedService).onApplicationBootstrap();
        expect(account).toEqual(before);
        // No identity persistence is consulted, even when its historical email exists.
        f.expectNoIdentityAccess();
        const logs = JSON.stringify(jest.mocked(Logger.prototype.log).mock.calls);
        for (const secret of [
          account.passwordHash,
          account.mfa.secret,
          account.session.accessVersion,
        ])
          expect(logs.includes(secret)).toBe(false);
        expect(logs.includes(email)).toBe(false);
      } finally {
        await context.close();
      }
    },
  );

  it('keeps the catalogue usable without users and avoids duplicate grants across repeated or concurrent startup', async () => {
    const f = fixture();
    const context = await f.compile();
    try {
      await context.init();
      const before = JSON.stringify({
        roles: [...f.roles],
        permissions: [...f.permissions],
        grants: [...f.grants],
      });
      const seed = context.get(RbacSeedService);
      jest.clearAllMocks();
      await seed.onApplicationBootstrap();
      await Promise.all([seed.onApplicationBootstrap(), seed.onApplicationBootstrap()]);
      expect(
        JSON.stringify({
          roles: [...f.roles],
          permissions: [...f.permissions],
          grants: [...f.grants],
        }),
      ).toBe(before);
      expect(f.repo.createRole).not.toHaveBeenCalled();
      expect(f.repo.createPermission).not.toHaveBeenCalled();
      expect(f.repo.updateRolePermissions).not.toHaveBeenCalled();
      expect(f.roleModel.updateOne).not.toHaveBeenCalled();
      // Existing catalogue label reconciliation remains intentional; identity persistence is forbidden.
      expect(f.repo.updatePermission).toHaveBeenCalledTimes(f.permissions.size * 3);
      expect((await context.get(RbacService).getRoleById('ADMIN')).permissions).toContain(
        'users.lock',
      );
      f.expectNoIdentityAccess();
    } finally {
      await context.close();
    }
  });

  it('does not initialize past an unavailable catalogue dependency', async () => {
    const f = fixture();
    jest.mocked(f.roleModel.findOne).mockImplementation(() => {
      throw new Error('Unavailable catalogue');
    });
    const context = await f.compile();
    try {
      await expect(context.init()).rejects.toThrow('Unavailable catalogue');
      f.expectNoIdentityAccess();
    } finally {
      // Nest waits on the rejected initialization promise again during close.
      await expect(context.close()).rejects.toThrow('Unavailable catalogue');
    }
  });

  it.each(environments)(
    'keeps the retired actor script inert for %s even with opt-in flags',
    (environment) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ENABLE_SEED: 'true',
        ALSM_ENABLE_DEV_TEST_ACCOUNTS: 'true',
      };
      if (environment === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = environment;
      const result = spawnSync(
        process.execPath,
        ['-r', 'ts-node/register', path.resolve(__dirname, '../scripts/seed-actors.ts')],
        {
          env,
          encoding: 'utf8',
          timeout: 15000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(
        'Actor seeding is disabled. See docs/security/RBAC_BOOTSTRAP.md.',
      );
    },
  );

  it.each(['staging', 'unknown', 'dev', 'prod', 'Development'])(
    'preserves central rejection of environment alias %s',
    (name) => {
      expect(environmentValidationSchema.extract('NODE_ENV').validate(name).error).toBeDefined();
    },
  );
  it('documents the central development default without granting it provisioning authority', () => {
    expect(environmentValidationSchema.extract('NODE_ENV').validate(undefined).value).toBe(
      'development',
    );
  });
});
