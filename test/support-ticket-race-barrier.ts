/** Test-only synchronization. No persistence, production hook or timing-based race simulation. */
interface RaceSession {
  readonly explicit: boolean;
  readonly hasEnded: boolean;
  inTransaction(): boolean;
}
export interface TicketRaceScope {
  readonly ticketId: string;
  readonly organizationId: string;
  readonly revision: number;
}
export interface TicketRaceObservation extends TicketRaceScope {
  readonly participant: 'left' | 'right';
  readonly session: RaceSession;
}

export function ticketRaceBarrier(expected: TicketRaceScope, timeoutMs = 5000) {
  const { ticketId, organizationId, revision } = expected;
  const observations = new Map<string, TicketRaceObservation>();
  let released = false,
    failure: Error | undefined;
  let resolve!: () => void, reject!: (error: Error) => void;
  const gate = new Promise<void>((allow, deny) => {
    resolve = allow;
    reject = deny;
  });
  // A participant can fail before anyone waits. Preserve the diagnostic without
  // creating an unhandled rejection; every arrive() still receives this failure.
  void gate.catch(() => undefined);
  const timer = setTimeout(
    () =>
      fail(
        new Error(
          `Ticket race barrier timed out: ready=${[...observations.keys()].join(',') || 'none'}; ` +
            `missing=${['left', 'right'].filter((name) => !observations.has(name)).join(',')}; ` +
            `ticket=${ticketId}; organization=${organizationId}; revision=${revision}`,
        ),
      ),
    timeoutMs,
  );

  function fail(error: Error) {
    if (released || failure) return;
    failure = error;
    clearTimeout(timer);
    reject(error);
  }
  function arrive(value: TicketRaceObservation): Promise<void> {
    if (failure) return Promise.reject(failure);
    if (released) return Promise.reject(new Error('Ticket race barrier already released'));
    const { participant, session } = value;
    try {
      if (observations.has(participant))
        throw new Error(`Duplicate race participant: ${participant}`);
      if (
        value.ticketId !== ticketId ||
        value.organizationId !== organizationId ||
        value.revision !== revision
      ) {
        throw new Error(
          `Race participant ${participant} observed a different Ticket/Organisation/revision`,
        );
      }
      if (!session.explicit || session.hasEnded || !session.inTransaction()) {
        throw new Error(`Race participant ${participant} requires an active explicit transaction`);
      }
      if ([...observations.values()].some((entry) => entry.session === session)) {
        throw new Error('Race participants must use distinct transaction sessions');
      }
      observations.set(participant, { participant, session, ticketId, organizationId, revision });
      if (observations.size === 2) {
        released = true;
        clearTimeout(timer);
        resolve();
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error('Invalid race participant'));
    }
    return gate;
  }
  return {
    arrive,
    observations: () => [...observations.values()].map((entry) => ({ ...entry })),
    assertReady() {
      if (failure) throw failure;
      if (!released) throw new Error('Both transactions have not reached the Ticket race barrier');
    },
    cancel: (error = new Error('Ticket race cancelled')) => fail(error),
  };
}
