import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Connection, createConnection } from 'mongoose';

export const UC66_CONTAINER = 'alsm-uc66-foundation-20261101-mongo';
export function verifyUc66Container() {
  const [info] = JSON.parse(
    execFileSync('docker', ['inspect', UC66_CONTAINER], { encoding: 'utf8', windowsHide: true }),
  );
  if (
    !info.State.Running ||
    info.Config.Labels['alsm.owner'] !== 'uc66-foundation-20261101' ||
    JSON.stringify(info.NetworkSettings.Ports['27017/tcp']) !==
      JSON.stringify([{ HostIp: '127.0.0.1', HostPort: '27128' }])
  )
    throw new Error('UC66 disposable container ownership/loopback binding mismatch');
  return info.Id as string;
}
export async function verifyOwnedUc66Uri(uri: string) {
  if (
    process.env.ALSM_UC66_TEST !== 'owned-local-only' ||
    !/^mongodb:\/\/127\.0\.0\.1:27128\/alsm_uc66_05a_[a-f0-9]{32}\?replicaSet=alsmUc66Foundation&directConnection=true$/.test(
      uri,
    )
  )
    throw new Error('Owned UC66 test database required');
  const containerId = verifyUc66Container();
  const connection = await createConnection(uri, {
    serverSelectionTimeoutMS: 3000,
    autoIndex: false,
  }).asPromise();
  try {
    if (
      !(await connection
        .collection('_uc66_05a_owner')
        .findOne({ database: connection.name, containerId })) ||
      (await connection.db!.admin().command({ hello: 1 })).setName !== 'alsmUc66Foundation'
    )
      throw new Error('UC66 database ownership marker required before schema/index provisioning');
  } finally {
    await connection.close();
  }
}
export async function createOwnedUc66Environment() {
  if (process.env.ALSM_UC66_TEST !== 'owned-local-only')
    throw new Error('Explicit owned-local-only opt-in required');
  const containerId = verifyUc66Container();
  const runId = randomUUID();
  const database = `alsm_uc66_05a_${runId.replaceAll('-', '')}`;
  const uri = `mongodb://127.0.0.1:27128/${database}?replicaSet=alsmUc66Foundation&directConnection=true`;
  const connection = await createConnection(uri, {
    serverSelectionTimeoutMS: 3000,
    autoIndex: false,
  }).asPromise();
  if ((await connection.db!.listCollections().toArray()).length !== 0)
    throw new Error('Disposable database already exists');
  await connection.collection('_uc66_05a_owner').insertOne({ runId, database, containerId });
  async function verify(target: Connection = connection) {
    if (
      verifyUc66Container() !== containerId ||
      target.name !== database ||
      !/^alsm_uc66_05a_[a-f0-9]{32}$/.test(database) ||
      (await target.db!.admin().command({ hello: 1 })).setName !== 'alsmUc66Foundation' ||
      !(await target.collection('_uc66_05a_owner').findOne({ runId, database, containerId }))
    )
      throw new Error('Disposable database ownership mismatch');
  }
  await verify();
  return {
    uri,
    database,
    connection,
    verify,
    async dispose() {
      await verify();
      await connection.dropDatabase();
      await connection.close();
    },
  };
}
