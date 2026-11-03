import { randomUUID } from 'node:crypto';
import { mongo, Types } from 'mongoose';
import { createOwnedUc66Environment } from './owned-environment';
import { createUc66TestApp } from './test-app';
import { seedUc66, uc66Ids } from './seed';
import {
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportContextParticipants,
  SupportContextUnitOfWork,
} from '../../src/modules/support/application/support-context.ports';

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
  let pauseAfterCommit = false;
  let release: (() => void) | undefined;
  const unit = a.app.get<SupportContextUnitOfWork>(SUPPORT_CONTEXT_UNIT_OF_WORK);
  const run = unit.run.bind(unit);
  unit.run = async <T>(id: string, work: (ports: SupportContextParticipants) => Promise<T>) => {
    const result = await run(id, work);
    if (pauseAfterCommit && typeof result === 'object' && result !== null && 'rows' in result) {
      pauseAfterCommit = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      console.log('Owned Workspace committed; delivery paused. Revoke authority then release.');
      await gate;
      release = undefined;
    }
    return result;
  };
  console.log(
    'UC66-05A owned Backend ready: http://127.0.0.1:3016/api/v1 (second independent instance: 3018).',
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    release?.();
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
        if (command === 'revoke-session') {
          await b.connection
            .collection('user_sessions')
            .updateMany(
              { userId: new Types.ObjectId(uc66Ids.actor) },
              { $set: { revokedAt: new Date() } },
            );
          console.log('Independent instance: test staff sessions revoked.');
        }
        if (command === 'deactivate-account') {
          await b.connection
            .collection('users')
            .updateOne({ _id: new Types.ObjectId(uc66Ids.actor) }, { $set: { isActive: false } });
          console.log('Independent instance: test staff account deactivated.');
        }
        if (command === 'expire-active-idle' || command === 'expire-active-absolute') {
          const createdAt = new Date(
            Date.now() - (command === 'expire-active-idle' ? 15 * 60000 + 1 : 31 * 60000),
          );
          const lastActivityAt =
            command === 'expire-active-idle'
              ? createdAt
              : new Date(createdAt.getTime() + 29 * 60000);
          await b.connection.collection('support_contexts').updateMany(
            { actorUserId: new Types.ObjectId(uc66Ids.actor), state: 'ACTIVE' },
            {
              $set: {
                createdAt,
                lastActivityAt,
                expiresAt: new Date(createdAt.getTime() + 30 * 60000),
              },
            },
          );
          console.log('Owned active fixture expired; runtime 30/15-minute policy unchanged.');
        }
        if (command === 'pause-next-workspace-after-commit') {
          pauseAfterCommit = true;
          console.log('Owned next Workspace delivery pause armed.');
        }
        if (command === 'release') release?.();
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
