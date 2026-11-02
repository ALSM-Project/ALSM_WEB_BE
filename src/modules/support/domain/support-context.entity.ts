import { isValidDate } from '../../../shared/utils/date.util';

/** Technical Owner decision, 1 November 2026. These are server policy, never request inputs. */
export const SUPPORT_CONTEXT_POLICY = Object.freeze({
  reference: 'UC66-TO-2026-11-01',
  absoluteLifetimeMs: 30 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
});

export type SupportContextState = 'ACTIVE' | 'EXITED' | 'EXPIRED' | 'REVOKED';
export interface SupportContextProps {
  id: string;
  actorUserId: string;
  originalSessionId: string;
  sessionVersion: string;
  authorityBinding: string;
  organizationId: string;
  audience: 'UC66';
  readOnly: true;
  policyReference: typeof SUPPORT_CONTEXT_POLICY.reference;
  state: SupportContextState;
  revision: number;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
}

export class SupportContextError extends Error {
  constructor(
    readonly code:
      'INVALID_SUPPORT_CONTEXT' | 'SUPPORT_CONTEXT_INACTIVE' | 'SUPPORT_CLOCK_UNAVAILABLE',
  ) {
    super(code);
  }
}

export class SupportContextEntity {
  private constructor(private readonly props: SupportContextProps) {}

  static create(
    input: Pick<
      SupportContextProps,
      | 'id'
      | 'actorUserId'
      | 'originalSessionId'
      | 'sessionVersion'
      | 'authorityBinding'
      | 'organizationId'
    > & { now: Date; authorityExpiresAt: Date },
  ): SupportContextEntity {
    return this.fromPersistence({
      id: input.id,
      actorUserId: input.actorUserId,
      originalSessionId: input.originalSessionId,
      sessionVersion: input.sessionVersion,
      authorityBinding: input.authorityBinding,
      organizationId: input.organizationId,
      audience: 'UC66',
      readOnly: true,
      policyReference: SUPPORT_CONTEXT_POLICY.reference,
      state: 'ACTIVE',
      revision: 1,
      createdAt: input.now,
      lastActivityAt: input.now,
      expiresAt: new Date(
        Math.min(
          input.now.getTime() + SUPPORT_CONTEXT_POLICY.absoluteLifetimeMs,
          input.authorityExpiresAt.getTime(),
        ),
      ),
      endedAt: null,
    });
  }

  static fromPersistence(input: SupportContextProps): SupportContextEntity {
    if (
      !input ||
      typeof input.id !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.id) ||
      [input.actorUserId, input.originalSessionId, input.organizationId].some(
        (id) => typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id),
      ) ||
      typeof input.sessionVersion !== 'string' ||
      !input.sessionVersion ||
      input.sessionVersion.length > 200 ||
      typeof input.authorityBinding !== 'string' ||
      !/^[a-f0-9]{64}$/.test(input.authorityBinding) ||
      input.audience !== 'UC66' ||
      input.readOnly !== true ||
      input.policyReference !== SUPPORT_CONTEXT_POLICY.reference ||
      !['ACTIVE', 'EXITED', 'EXPIRED', 'REVOKED'].includes(input.state) ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1 ||
      !isValidDate(input.createdAt) ||
      !isValidDate(input.lastActivityAt) ||
      !isValidDate(input.expiresAt) ||
      input.expiresAt.getTime() <= input.createdAt.getTime() ||
      input.expiresAt.getTime() >
        input.createdAt.getTime() + SUPPORT_CONTEXT_POLICY.absoluteLifetimeMs ||
      input.lastActivityAt.getTime() < input.createdAt.getTime() ||
      input.lastActivityAt.getTime() >= input.expiresAt.getTime() ||
      (input.state === 'ACTIVE'
        ? input.endedAt !== null
        : !isValidDate(input.endedAt) || input.endedAt.getTime() < input.lastActivityAt.getTime())
    )
      throw new SupportContextError('INVALID_SUPPORT_CONTEXT');
    return new SupportContextEntity(structuredClone(input));
  }

  isActive(now: Date): boolean {
    this.checkClock(now);
    return (
      this.props.state === 'ACTIVE' &&
      now.getTime() < this.props.expiresAt.getTime() &&
      now.getTime() < this.idleExpiresAt().getTime()
    );
  }

  /** Capture the committed window before provisional activity can advance it. */
  captureActivityWindow(): (now: Date) => boolean {
    const committed = SupportContextEntity.fromPersistence(this.props);
    // Keep current state/backwards-clock checks as well as the detached original deadlines.
    return (now) => committed.isActive(now) && this.isActive(now);
  }

  activity(now: Date): void {
    if (!this.isActive(now)) throw new SupportContextError('SUPPORT_CONTEXT_INACTIVE');
    this.props.lastActivityAt = new Date(now);
    this.props.revision++;
  }

  end(state: Exclude<SupportContextState, 'ACTIVE'>, now: Date): boolean {
    this.checkClock(now);
    if (this.props.state !== 'ACTIVE') return false;
    this.props.state = state;
    this.props.endedAt = new Date(now);
    this.props.revision++;
    return true;
  }

  idleExpiresAt(): Date {
    return new Date(
      Math.min(
        this.props.expiresAt.getTime(),
        this.props.lastActivityAt.getTime() + SUPPORT_CONTEXT_POLICY.idleTimeoutMs,
      ),
    );
  }

  toProps(): SupportContextProps {
    return structuredClone(this.props);
  }

  private checkClock(now: Date): void {
    if (!isValidDate(now) || now.getTime() < this.props.lastActivityAt.getTime())
      throw new SupportContextError('SUPPORT_CLOCK_UNAVAILABLE');
  }
}
