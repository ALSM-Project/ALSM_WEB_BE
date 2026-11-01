import { ticketRaceBarrier, TicketRaceObservation } from './support-ticket-race-barrier';

const scope = { ticketId: 'ticket', organizationId: 'org', revision: 7 };
function arrival(participant: 'left' | 'right'): TicketRaceObservation {
  return {
    ...scope,
    participant,
    session: { explicit: true, hasEnded: false, inTransaction: () => true },
  };
}
describe('P2 test-only Ticket transaction overlap barrier', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('blocks the first write and releases both only after matching distinct transactions arrive', async () => {
    const barrier = ticketRaceBarrier(scope),
      writes: string[] = [];
    const left = barrier.arrive(arrival('left')).then(() => {
      writes.push('left');
    });
    await Promise.resolve();
    expect(writes).toEqual([]);
    expect(() => barrier.assertReady()).toThrow('Both transactions');
    const right = barrier.arrive(arrival('right')).then(() => {
      writes.push('right');
    });
    await Promise.all([left, right]);
    barrier.assertReady();
    expect(writes.sort()).toEqual(['left', 'right']);
    expect(
      barrier.observations().map(({ participant, ticketId, organizationId, revision }) => ({
        participant,
        ticketId,
        organizationId,
        revision,
      })),
    ).toEqual([
      { ...scope, participant: 'left' },
      { ...scope, participant: 'right' },
    ]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out with a missing-participant diagnostic, rejects late arrivals and clears the timer', async () => {
    const barrier = ticketRaceBarrier(scope, 100),
      written = jest.fn();
    const first = barrier
      .arrive(arrival('left'))
      .then(written)
      .catch((error: unknown) => error);
    await jest.advanceTimersByTimeAsync(100);
    expect(await first).toMatchObject({ message: expect.stringContaining('missing=right') });
    await expect(barrier.arrive(arrival('right'))).rejects.toThrow('timed out');
    expect(() => barrier.assertReady()).toThrow('revision=7');
    expect(written).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['ticketId', 'organizationId', 'revision'] as const)(
    'aborts both waiters on mismatched %s',
    async (field) => {
      const barrier = ticketRaceBarrier(scope),
        written = jest.fn();
      const left = barrier.arrive(arrival('left')).then(written);
      const right = barrier
        .arrive({ ...arrival('right'), [field]: field === 'revision' ? 8 : 'other' })
        .then(written);
      expect((await Promise.allSettled([left, right])).map((result) => result.status)).toEqual([
        'rejected',
        'rejected',
      ]);
      expect(() => barrier.assertReady()).toThrow('different Ticket/Organisation/revision');
      expect(written).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it.each(['duplicate participant', 'same session', 'inactive transaction'] as const)(
    'does not release on %s',
    async (kind) => {
      const barrier = ticketRaceBarrier(scope),
        leftInfo = arrival('left');
      let rightInfo = arrival('right');
      const left = barrier.arrive(leftInfo);
      if (kind === 'duplicate participant') rightInfo = { ...rightInfo, participant: 'left' };
      if (kind === 'same session') rightInfo = { ...rightInfo, session: leftInfo.session };
      if (kind === 'inactive transaction')
        rightInfo = {
          ...rightInfo,
          session: { explicit: true, hasEnded: false, inTransaction: () => false },
        };
      const results = await Promise.allSettled([left, barrier.arrive(rightInfo)]);
      expect(results.every((result) => result.status === 'rejected')).toBe(true);
      expect(() => barrier.assertReady()).toThrow();
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('cancels waiting participants when test setup or an operation fails early', async () => {
    const barrier = ticketRaceBarrier(scope),
      left = barrier.arrive(arrival('left'));
    barrier.cancel(new Error('TEST early failure'));
    await expect(left).rejects.toThrow('TEST early failure');
    await expect(barrier.arrive(arrival('right'))).rejects.toThrow('TEST early failure');
    expect(jest.getTimerCount()).toBe(0);
  });
});
