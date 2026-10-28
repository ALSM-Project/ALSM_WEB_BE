import { Logger } from '@nestjs/common';

/**
 * Runs a database seed that must happen at startup without holding the server back.
 *
 * Seeds write one record after another, and against a remote database each write is a network
 * round trip, so a full seed can take minutes - and the HTTP port only opens once every
 * onApplicationBootstrap hook has returned. By default the seed runs in the background and its
 * progress and any failure are logged; set STARTUP_SEED_BLOCKING=true to wait for it instead.
 */
export async function runStartupSeed(
  logger: Logger,
  name: string,
  task: () => Promise<void>,
): Promise<void> {
  const started = Date.now();
  const seconds = () => ((Date.now() - started) / 1000).toFixed(1);
  const blocking = process.env.STARTUP_SEED_BLOCKING === 'true';
  logger.log(`${name} seed started${blocking ? '' : ' in the background'}`);
  const run = task().then(
    () => logger.log(`${name} seed finished in ${seconds()}s`),
    (error: unknown) => logger.error(`${name} seed failed after ${seconds()}s: ${String(error)}`),
  );
  if (blocking) await run;
}
