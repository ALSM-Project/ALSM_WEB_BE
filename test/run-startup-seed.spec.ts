import { Logger } from '@nestjs/common';
import { runStartupSeed } from '../src/shared/startup/run-startup-seed';

describe('runStartupSeed', () => {
  const logger = { log: jest.fn(), error: jest.fn() } as unknown as Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STARTUP_SEED_BLOCKING;
  });

  it('returns before a slow seed finishes, so the server can open its port', async () => {
    let finish!: () => void;
    const seed = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));

    await runStartupSeed(logger, 'RBAC', seed);

    expect(seed).toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledTimes(1);
    finish();
    await new Promise((r) => setImmediate(r));
    expect(logger.log).toHaveBeenLastCalledWith(expect.stringMatching(/RBAC seed finished in \d+\.\ds/));
  });

  it('logs a failing seed instead of crashing the process', async () => {
    await runStartupSeed(logger, 'Menu', () => Promise.reject(new Error('duplicate key')));
    await new Promise((r) => setImmediate(r));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Menu seed failed'));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('duplicate key'));
  });

  it('waits for the seed when STARTUP_SEED_BLOCKING=true', async () => {
    process.env.STARTUP_SEED_BLOCKING = 'true';
    let done = false;
    await runStartupSeed(logger, 'RBAC', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    expect(done).toBe(true);
  });
});
