import { createUc66TestApp } from './test-app';
import { SUPPORT_PROJECT_READER } from '../../src/modules/projects/application/support-project-reader.port';
import { DiagnosticReaderFactory } from '../../src/shared/application/diagnostic-read.port';
import { uc66Ids } from './seed';

interface Command {
  type: string;
  uri?: string;
  secret?: string;
}
let instance: Awaited<ReturnType<typeof createUc66TestApp>> | undefined;
let release: (() => void) | undefined;
process.on('message', (message: Command) => {
  void (async () => {
    if (message.type === 'start') {
      if (instance || !message.uri || !message.secret)
        throw new Error('Invalid owned child startup');
      instance = await createUc66TestApp(message.uri, message.secret, { now: () => new Date() });
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
    }
  })().catch((error: unknown) =>
    process.send?.({
      type: 'error',
      message: error instanceof Error ? error.message : 'Owned child failure',
    }),
  );
});
