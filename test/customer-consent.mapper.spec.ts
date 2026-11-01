import { Mongoose, Types } from 'mongoose';
import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import {
  customerConsentFromSnapshot,
  customerConsentScope,
  customerConsentToSnapshot,
} from '../src/modules/support/infrastructure/customer-consent.mapper';
import {
  CUSTOMER_CONSENT_MODEL,
  CUSTOMER_CONSENT_SOURCE_INDEX,
  CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
  CustomerConsentSchema,
} from '../src/modules/support/infrastructure/customer-consent.schema';
import { consentIds } from './customer-consent.fixtures';
import {
  negativeConsentFixture,
  persistedConsentFixture,
} from './customer-consent.persistence.fixtures';

describe('Customer Consent schema and raw BSON mapping (no database)', () => {
  it.each(['PENDING_VERIFICATION', 'DECLINED', 'INVALIDATED'] as const)(
    'round-trips %s without authority elevation or lost history',
    async (state) => {
      const pending = persistedConsentFixture();
      const consent =
        state === 'PENDING_VERIFICATION'
          ? pending
          : negativeConsentFixture(pending, state === 'DECLINED' ? 'DECLINE' : 'INVALIDATE');
      const snapshot = customerConsentToSnapshot(consent);
      expect(snapshot._id).toBe(consent.toProps().consentId);
      expect(snapshot.organizationId).toBeInstanceOf(Types.ObjectId);
      expect(snapshot.createdByUserId.toHexString()).toBe(consentIds.actor);
      expect(customerConsentFromSnapshot(snapshot).toProps()).toEqual(consent.toProps());
      const mongoose = new Mongoose();
      const model = mongoose.model(CUSTOMER_CONSENT_MODEL, CustomerConsentSchema);
      await expect(new model(snapshot).validate()).resolves.toBeUndefined();
      expect(snapshot).not.toHaveProperty('expiresAt');
      expect(snapshot).not.toHaveProperty('operationalAccess');
    },
  );
  it('returns fully detached dates, references and history', () => {
    const original = persistedConsentFixture(),
      snapshot = customerConsentToSnapshot(original),
      copy = customerConsentFromSnapshot(snapshot);
    snapshot.createdAt.setUTCFullYear(2000);
    Object.assign(snapshot.scope, { projectionId: 'changed' });
    Object.assign(snapshot.history[0].source, { evidenceId: 'changed' });
    expect(copy.toProps()).toEqual(original.toProps());
  });
  it.each([
    '_id',
    'schemaVersion',
    'ticketId',
    'organizationId',
    'episodeId',
    'purposeId',
    'scope',
    'beneficiary',
    'coverage',
    'policy',
    'grantor',
    'customerAuthority',
    'requestSource',
    'state',
    'revision',
    'createdByUserId',
    'updatedByUserId',
    'createdAt',
    'updatedAt',
    'history',
  ])('rejects missing %s without hydration/default repair', (field) => {
    const snapshot = customerConsentToSnapshot(persistedConsentFixture());
    Reflect.deleteProperty(snapshot, field);
    expect(() => customerConsentFromSnapshot(snapshot)).toThrow();
  });
  it.each(['VERIFIED_GRANTED', 'WITHDRAWN', 'EXPIRED', 'SUPERSEDED', 'NOT_REQUESTED', 'UNKNOWN'])(
    'rejects unsupported raw and schema state %s',
    async (state) => {
      const snapshot = customerConsentToSnapshot(persistedConsentFixture());
      Object.assign(snapshot, { state });
      expect(() => customerConsentFromSnapshot(snapshot)).toThrow();
      const mongoose = new Mongoose(),
        model = mongoose.model(CUSTOMER_CONSENT_MODEL, CustomerConsentSchema);
      await expect(new model(snapshot).validate()).rejects.toThrow();
    },
  );
  it.each([
    { revision: '0' },
    { revision: 1 },
    { history: [] },
    { createdAt: '2026-10-29' },
    { organizationId: consentIds.organization },
    { createdByUserId: consentIds.actor },
    { updatedByUserId: 'owner-slug' },
    { episodeId: 'episode-slug' },
  ])('rejects malformed raw snapshot %j', (patch) => {
    const snapshot = customerConsentToSnapshot(persistedConsentFixture());
    Object.assign(snapshot, patch);
    expect(() => customerConsentFromSnapshot(snapshot)).toThrow();
  });
  it.each(['verified', 'rawEvidence', 'credential', 'expiresAt', '__v'])(
    'rejects unapproved stored field %s',
    (field) => {
      const snapshot = customerConsentToSnapshot(persistedConsentFixture());
      Object.assign(snapshot, { [field]: 'not-permitted' });
      expect(() => customerConsentFromSnapshot(snapshot)).toThrow();
    },
  );
  it('does not execute top-level or nested stored accessors', () => {
    const snapshot = customerConsentToSnapshot(persistedConsentFixture()),
      getter = jest.fn(() => 'secret');
    Object.defineProperty(snapshot, 'state', { get: getter });
    expect(() => customerConsentFromSnapshot(snapshot)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const nested = customerConsentToSnapshot(persistedConsentFixture());
    Object.defineProperty(nested.scope, 'projectionId', { get: getter });
    expect(() => customerConsentFromSnapshot(nested)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it('validates entity-like write input instead of trusting its declared type', () => {
    const p = persistedConsentFixture().toProps();
    expect(() =>
      customerConsentToSnapshot({
        toProps: () => ({ ...p, state: 'VERIFIED_GRANTED' }),
      } as unknown as CustomerConsentEntity),
    ).toThrow();
  });
  it.each(['', 'slug', 'A'.repeat(24)])(
    'rejects noncanonical Organisation %s without slug conversion',
    (organization) => {
      expect(() =>
        customerConsentScope(consentIds.consent, organization, consentIds.ticket),
      ).toThrow();
    },
  );
  it('declares exact scoped source-event uniqueness with no TTL index or lifecycle default', () => {
    expect(CustomerConsentSchema.indexes()).toEqual([
      [
        CUSTOMER_CONSENT_SOURCE_INDEX,
        expect.objectContaining({
          name: CUSTOMER_CONSENT_SOURCE_INDEX_NAME,
          unique: true,
          collation: { locale: 'simple' },
        }),
      ],
    ]);
    expect(
      CustomerConsentSchema.indexes().some(([, options]) => 'expireAfterSeconds' in options),
    ).toBe(false);
    expect(CustomerConsentSchema.options.timestamps).toBe(false);
    expect(CustomerConsentSchema.options.versionKey).toBe(false);
    expect(CustomerConsentSchema.path('state').options.default).toBeUndefined();
    expect(CustomerConsentSchema.path('history').options.default).toBeUndefined();
  });
});
