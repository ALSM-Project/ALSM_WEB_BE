import { randomUUID } from 'node:crypto';
import { mongo } from 'mongoose';
import { createOwnedUc66Environment } from './owned-environment';
import { createUc66TestApp } from './test-app';
import { seedUc66, uc66Ids } from './seed';

/** Explicit loopback-only browser harness. Never imported by production entrypoints. */
async function main() {
  const owned = await createOwnedUc66Environment();
  const secret = `owned-browser-${randomUUID()}`;
  const clock = { now: () => new Date() };
  const a = await createUc66TestApp(owned.uri, secret, clock);
  const b = await createUc66TestApp(owned.uri, secret, clock);
  await seedUc66(a.connection);
  await a.app.listen(3016, '127.0.0.1');
  await b.app.listen(3018, '127.0.0.1');
  console.log(
    'UC66-05A owned Backend ready: http://127.0.0.1:3016/api/v1 (second independent instance: 3018).',
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await a.app.close();
    await b.app.close();
    await owned.dispose();
    console.log('UC66-05A applications stopped and owned disposable database dropped.');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (input: string) => {
    void (async () => {
      await owned.verify();
      for (const command of input.trim().split(/\r?\n/)) {
        if (command === 'stop') await stop();
        if (command === 'revoke-role') {
          await b.connection.collection('user_roles').deleteMany({ userId: uc66Ids.actor });
          console.log('Independent instance: test staff role revoked.');
        }
        if (command === 'lose-next-commit') {
          const original = a.connection.startSession.bind(a.connection);
          a.connection.startSession = async (...args: Parameters<typeof original>) => {
            a.connection.startSession = original;
            const session = await original(...args),
              commit = session.commitTransaction.bind(session);
            session.commitTransaction = async () => {
              await commit();
              throw new mongo.MongoServerError({
                message: 'Owned browser test: commit acknowledgement lost',
                code: 50,
              });
            };
            return session;
          };
          console.log(
            'Owned test fault armed for next commit acknowledgement (no business replay).',
          );
        }
      }
    })().catch((error: unknown) => console.error(error));
  });
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
