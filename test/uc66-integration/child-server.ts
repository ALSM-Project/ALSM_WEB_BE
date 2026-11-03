import { createUc66TestApp } from './test-app';
import { SUPPORT_PROJECT_READER } from '../../src/modules/projects/application/support-project-reader.port';
import { DiagnosticReaderFactory } from '../../src/shared/application/diagnostic-read.port';
import { uc66Ids } from './seed';
import {
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportContextParticipants,
  SupportContextUnitOfWork,
} from '../../src/modules/support/application/support-context.ports';
import {
  TRANSACTIONAL_AUDIT_FACTORY,
  TransactionalAuditFactory,
} from '../../src/modules/audit/domain/transactional-audit.port';
import { mongo } from 'mongoose';

interface Command {
  type: string;
  uri?: string;
  secret?: string;
}
let instance: Awaited<ReturnType<typeof createUc66TestApp>> | undefined;
let release: (() => void) | undefined;
let businessCallbacks = 0;
let auditFault: 'pause' | 'fail' | undefined;
let pauseCommitted = false;
async function checkpoint(type: string) {
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  process.send?.({ type });
  await gate;
  release = undefined;
}
process.on('message', (message: Command) => {
  void (async () => {
    if (message.type === 'start') {
      if (instance || !message.uri || !message.secret)
        throw new Error('Invalid owned child startup');
      instance = await createUc66TestApp(message.uri, message.secret, { now: () => new Date() });
      // Instrument only this explicitly owned child. Real work/audit/commit still run.
      const unit = instance.app.get<SupportContextUnitOfWork>(SUPPORT_CONTEXT_UNIT_OF_WORK);
      const run = unit.run.bind(unit);
      unit.run = async <T>(id: string, work: (ports: SupportContextParticipants) => Promise<T>) => {
        const result = await run(id, (ports) => {
          businessCallbacks++;
          return work(ports);
        });
        if (pauseCommitted && typeof result === 'object' && result !== null && 'rows' in result) {
          pauseCommitted = false;
          await checkpoint('committed');
        }
        return result;
      };
      const factory = instance.app.get<TransactionalAuditFactory>(TRANSACTIONAL_AUDIT_FACTORY);
      const bindAudit = factory.bind.bind(factory);
      factory.bind = (transaction) => {
        const audit = bindAudit(transaction);
        return {
          append: async (event) => {
            await audit.append(event);
            if (event.action !== 'SUPPORT_WORKSPACE_READ' || !auditFault) return;
            const fault = auditFault;
            auditFault = undefined;
            if (fault === 'fail') throw new Error('Owned test: audit acknowledgement failed');
            await checkpoint('audited');
          },
        };
      };
      await instance.app.listen(0, '127.0.0.1');
      const address = instance.app.getHttpServer().address() as { port: number };
      process.send?.({ type: 'ready', port: address.port, pid: process.pid });
    } else if (message.type === 'stop') {
      release?.();
      await instance?.app.close();
      process.send?.({ type: 'stopped' });
      process.exit(0);
    } else if (message.type === 'revoke-role') {
      await instance!.connection.collection('user_roles').deleteMany({ userId: uc66Ids.actor });
      process.send?.({ type: 'revoked' });
    } else if (message.type === 'pause-projection') {
      const factory = instance!.app.get<DiagnosticReaderFactory>(SUPPORT_PROJECT_READER),
        bind = factory.bind.bind(factory);
      let armed = true;
      factory.bind = (transaction) => {
        const reader = bind(transaction);
        return {
          read: async (query) => {
            const rows = await reader.read(query);
            if (armed) {
              armed = false;
              factory.bind = bind;
              const gate = new Promise<void>((resolve) => {
                release = resolve;
              });
              process.send?.({ type: 'projected' });
              await gate;
            }
            return rows;
          },
        };
      };
      process.send?.({ type: 'armed' });
    } else if (message.type === 'release') {
      release?.();
    } else if (message.type === 'pause-audit' || message.type === 'fail-audit') {
      auditFault = message.type === 'pause-audit' ? 'pause' : 'fail';
      process.send?.({ type: 'armed' });
    } else if (message.type === 'pause-after-commit') {
      pauseCommitted = true;
      process.send?.({ type: 'armed' });
    } else if (message.type === 'lose-commit-ack') {
      const start = instance!.connection.startSession.bind(instance!.connection);
      instance!.connection.startSession = async (...args: Parameters<typeof start>) => {
        instance!.connection.startSession = start;
        const session = await start(...args);
        const commit = session.commitTransaction.bind(session);
        session.commitTransaction = async () => {
          await commit();
          throw new mongo.MongoServerError({ message: 'Owned test: commit ACK lost', code: 50 });
        };
        return session;
      };
      process.send?.({ type: 'armed' });
    } else if (message.type === 'reset-metrics') {
      businessCallbacks = 0;
      process.send?.({ type: 'metrics', businessCallbacks });
    } else if (message.type === 'metrics') {
      process.send?.({ type: 'metrics', businessCallbacks });
    }
  })().catch((error: unknown) =>
    process.send?.({
      type: 'error',
      message: error instanceof Error ? error.message : 'Owned child failure',
    }),
  );
});
