import { randomUUID } from 'node:crypto';
import {
  SUPPORT_CONTEXT_POLICY,
  SupportContextEntity,
} from '../src/modules/support/domain/support-context.entity';
import { supportOrganizationId, supportSessionId, supportUserId } from './uc66-foundation.fixtures';

function context(until = 60 * 60 * 1000) {
  const now = new Date('2026-11-01T00:00:00Z');
  return SupportContextEntity.create({
    id: randomUUID(),
    actorUserId: supportUserId,
    originalSessionId: supportSessionId,
    organizationId: supportOrganizationId,
    sessionVersion: 'original',
    authorityBinding: 'a'.repeat(64),
    now,
    authorityExpiresAt: new Date(now.getTime() + until),
  });
}

describe('Technical Owner-approved UC-66 context lifetime', () => {
  it('caps absolute lifetime at 30 minutes and idle at 15 minutes', () => {
    const c = context(),
      p = c.toProps();
    expect(p.expiresAt.getTime() - p.createdAt.getTime()).toBe(30 * 60 * 1000);
    expect(c.idleExpiresAt().getTime() - p.createdAt.getTime()).toBe(15 * 60 * 1000);
    expect(SUPPORT_CONTEXT_POLICY.reference).toBe('UC66-TO-2026-11-01');
  });

  it('clamps lifetime to the original session/temporary authority expiry', () => {
    const c = context(60000);
    expect(c.idleExpiresAt()).toEqual(c.toProps().expiresAt);
  });

  it('authorized activity moves idle time but never renews the absolute expiry', () => {
    const c = context(),
      start = c.toProps().createdAt.getTime();
    for (const minute of [10, 20, 29]) c.activity(new Date(start + minute * 60000));
    expect(c.toProps().lastActivityAt).toEqual(new Date(start + 29 * 60000));
    expect(c.idleExpiresAt()).toEqual(new Date(start + 30 * 60000));
    expect(() => c.activity(new Date(start + 30 * 60000))).toThrow('SUPPORT_CONTEXT_INACTIVE');
  });

  it('pending activity cannot extend the captured committed window, including exact equality', () => {
    const c = context(),
      start = c.toProps().createdAt.getTime();
    const canCommit = c.captureActivityWindow();
    c.activity(new Date(start + 14 * 60000 + 59000));
    expect(canCommit(new Date(start + 14 * 60000 + 59500))).toBe(true);
    expect(c.isActive(new Date(start + 15 * 60000))).toBe(true);
    expect(canCommit(new Date(start + 15 * 60000))).toBe(false);
    expect(canCommit(new Date(start + 15 * 60000 + 1000))).toBe(false);
  });

  it('a fresh persisted snapshot uses its newly committed activity window', () => {
    const c = context(),
      start = c.toProps().createdAt.getTime();
    c.activity(new Date(start + 14 * 60000));
    const next = SupportContextEntity.fromPersistence(c.toProps());
    const canCommit = next.captureActivityWindow();
    next.activity(new Date(start + 16 * 60000));
    expect(canCommit(new Date(start + 16 * 60000 + 1000))).toBe(true);
    expect(canCommit(new Date(start + 29 * 60000))).toBe(false);
    expect(next.toProps().expiresAt).toEqual(c.toProps().expiresAt);
  });

  it('the captured window retains current-state and backwards-clock protection', () => {
    const c = context(),
      start = c.toProps().createdAt.getTime();
    const canCommit = c.captureActivityWindow();
    const activity = new Date(start + 14 * 60000);
    c.activity(activity);
    expect(() => canCommit(new Date(activity.getTime() - 1))).toThrow('SUPPORT_CLOCK_UNAVAILABLE');
    c.end('EXITED', activity);
    expect(canCommit(activity)).toBe(false);
  });

  it.each([15, 30])('denies activity at the exact %s-minute idle/absolute boundary', (minutes) => {
    const c = context();
    expect(() => c.activity(new Date(c.toProps().createdAt.getTime() + minutes * 60000))).toThrow(
      'SUPPORT_CONTEXT_INACTIVE',
    );
    expect(c.toProps().revision).toBe(1);
  });

  it('Exit terminates immediately and repeated Exit is idempotent', () => {
    const c = context(),
      now = c.toProps().createdAt;
    expect(c.end('EXITED', now)).toBe(true);
    expect(c.end('EXITED', now)).toBe(false);
    expect(c.isActive(now)).toBe(false);
    expect(() => c.activity(now)).toThrow('SUPPORT_CONTEXT_INACTIVE');
  });

  it('rejects a backwards clock without moving idle time', () => {
    const c = context(),
      before = c.toProps();
    expect(() => c.activity(new Date(before.createdAt.getTime() - 1))).toThrow(
      'SUPPORT_CLOCK_UNAVAILABLE',
    );
    expect(c.toProps()).toEqual(before);
  });

  it.each([
    { readOnly: false },
    { audience: 'CUSTOMER' },
    { organizationId: 'forged' },
    { authorityBinding: '' },
    { sessionVersion: '' },
    { policyReference: 'client-policy' },
    { state: 'UNRECOGNIZED' },
    { expiresAt: new Date('2027-01-01') },
  ])('rejects corrupt persisted capability %j', (changes) => {
    expect(() =>
      SupportContextEntity.fromPersistence({ ...context().toProps(), ...changes } as Parameters<
        typeof SupportContextEntity.fromPersistence
      >[0]),
    ).toThrow('INVALID_SUPPORT_CONTEXT');
  });

  it('detaches snapshots so callers cannot mutate its scope, mode or timestamps', () => {
    const c = context(),
      snapshot = c.toProps();
    snapshot.organizationId = 'forged';
    snapshot.createdAt.setTime(0);
    expect(c.toProps().organizationId).toBe(supportOrganizationId);
    expect(c.toProps().createdAt.getTime()).not.toBe(0);
  });
});
