import { createConnection } from 'mongoose';
import { verifyOwnedUc66Uri } from './owned-environment';
import { SUPPORT_CONTEXT_POLICY } from '../../src/modules/support/domain/support-context.entity';
import { SUPPORT_ACTIVE_ORIGIN_INDEX } from '../../src/modules/support/infrastructure/support-context.schema';

/** Evidence only: hardcoded owned loopback fixture, no env-file, AppModule or index writes. */
async function main() {
  if (process.env.ALSM_UC66_TEST !== 'owned-local-only')
    throw new Error('Explicit owned-local-only opt-in required');
  const probe = await fetch('http://127.0.0.1:3016/api/v1/__uc66_test_identity');
  const database = probe.headers.get('x-uc66-owned-test') ?? '';
  if (!/^alsm_uc66_05a_[a-f0-9]{32}$/.test(database))
    throw new Error('Owned HTTP identity marker unavailable');
  const uri = `mongodb://127.0.0.1:27128/${database}?replicaSet=alsmUc66Foundation&directConnection=true`;
  await verifyOwnedUc66Uri(uri);
  const connection = await createConnection(uri, { autoIndex: false }).asPromise();
  try {
    const hello = await connection.db!.admin().command({ hello: 1 });
    const build = await connection.db!.admin().command({ buildInfo: 1 });
    const contextIndexes = await connection.collection('support_contexts').listIndexes().toArray();
    const auditIndexes = await connection.collection('audit_logs').listIndexes().toArray();
    const required = contextIndexes.find((index) => index.name === SUPPORT_ACTIVE_ORIGIN_INDEX);
    const exactRequiredIndex = Boolean(
      required?.unique === true &&
      JSON.stringify(required.key) === JSON.stringify({ actorUserId: 1, originalSessionId: 1 }) &&
      JSON.stringify(required.partialFilterExpression) === JSON.stringify({ state: 'ACTIVE' }) &&
      !required.collation,
    );
    const role = await connection
      .collection('roles')
      .findOne({ id: 'INTERNAL_SUPPORT' }, { projection: { _id: 0, id: 1, isSystem: 1 } });
    const permissionGrant = await connection.collection('role_permissions').countDocuments({
      roleId: 'INTERNAL_SUPPORT',
      permissionKey: 'organizations.impersonate',
    });
    const policy = { ...SUPPORT_CONTEXT_POLICY };
    const ready = Boolean(
      hello.isWritablePrimary &&
      hello.setName &&
      exactRequiredIndex &&
      role?.isSystem &&
      permissionGrant === 1,
    );
    console.log(
      JSON.stringify(
        {
          scope: 'owned disposable local fixture; not intended deployment',
          database,
          mongoVersion: build.version,
          replicaSet: hello.setName,
          writablePrimary: hello.isWritablePrimary,
          singleMemberFixture: hello.hosts?.length === 1,
          exactRequiredIndex,
          contextIndexes,
          auditIndexes,
          contextTtlPresent: contextIndexes.some((index) => index.expireAfterSeconds !== undefined),
          auditTtlPresent: auditIndexes.some((index) => index.expireAfterSeconds !== undefined),
          internalSupportRole: role,
          exactImpersonateGrantCount: permissionGrant,
          supportPolicy: policy,
          writesOrIndexChangesMade: false,
          ready,
          deploymentDurabilityAndRetention:
            'UNVERIFIED: physical persistence, failover and approved retention require intended-environment evidence',
        },
        null,
        2,
      ),
    );
    if (!ready) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Owned readiness inspection failed');
  process.exitCode = 1;
});
