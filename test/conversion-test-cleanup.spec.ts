interface CleanupHelpers {
  bounded<T>(work: () => Promise<T>, milliseconds: number, label: string): Promise<T>;
  cleanupAll(steps: [string, () => Promise<void>, number?][]): Promise<void>;
  fixtureEngines(): {
    execute<T>(
      engine: (input: object, signal: AbortSignal) => Promise<T>,
      input: object,
    ): Promise<T>;
    abortAll(): void;
  };
}
const { bounded, cleanupAll, fixtureEngines } = jest.requireActual<CleanupHelpers>(
  './conversion-test-cleanup.cjs',
);

describe('owned conversion integration cleanup', () => {
  it('aborts a pending fixture before worker drain and permits the next case', async () => {
    const fixtures = fixtureEngines();
    let signal: AbortSignal | undefined;
    const pending = fixtures.execute(async (_input, abortSignal) => {
      signal = abortSignal;
      return new Promise<never>(() => {});
    }, {});
    const aborted = expect(pending).rejects.toThrow('Fixture engine aborted for cleanup');
    await Promise.resolve();
    fixtures.abortAll();
    await aborted;
    expect(signal?.aborted).toBe(true);
    await expect(fixtures.execute(async () => 'next fixture', {})).resolves.toBe('next fixture');
  });

  it('continues all resource cleanup steps after a worker drain times out', async () => {
    const cleanup = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
    await expect(
      cleanupAll([
        ['Blocked worker', () => new Promise<void>(() => {}), 10],
        ['Owned services', cleanup],
      ]),
    ).rejects.toThrow('Owned test resource cleanup failed');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('clears a deadline when cleanup completes', async () => {
    jest.useFakeTimers();
    try {
      await expect(bounded(async () => 'closed', 5000, 'fixture')).resolves.toBe('closed');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
