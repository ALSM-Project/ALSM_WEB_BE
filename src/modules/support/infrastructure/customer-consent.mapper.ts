import { Types } from 'mongoose';
import { CustomerConsentEntity } from '../domain/customer-consent.entity';
import {
  consentAccountId,
  consentUuid,
  invalidConsent,
} from '../domain/customer-consent.validation';
import type { CustomerConsentProps } from '../domain/customer-consent.types';
import type { CustomerConsentSnapshot } from './customer-consent.schema';

const snapshotKeys = [
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
];

function bsonAccount(value: unknown): string {
  if (!(value instanceof Types.ObjectId)) invalidConsent();
  const id = value.toHexString();
  consentAccountId(id);
  return id;
}

/** Raw/lean BSON only. Reject unknown fields, missing data and accessor claims. */
export function customerConsentFromSnapshot(value: unknown): CustomerConsentEntity {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    invalidConsent();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== snapshotKeys.length || snapshotKeys.some((key) => !Object.hasOwn(value, key)))
    invalidConsent();
  const data = Object.fromEntries(
    snapshotKeys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) invalidConsent();
      return [key, descriptor.value];
    }),
  );
  const { _id, organizationId, createdByUserId, updatedByUserId, ...rest } = data;
  consentUuid(_id);
  return CustomerConsentEntity.fromPersistence({
    ...rest,
    consentId: _id,
    organizationId: bsonAccount(organizationId),
    createdByUserId: bsonAccount(createdByUserId),
    updatedByUserId: bsonAccount(updatedByUserId),
  } as CustomerConsentProps);
}

export function customerConsentToSnapshot(consent: CustomerConsentEntity): CustomerConsentSnapshot {
  const p = CustomerConsentEntity.fromPersistence(consent.toProps()).toProps();
  const { consentId, organizationId, createdByUserId, updatedByUserId, ...rest } = p;
  return {
    ...rest,
    _id: consentId,
    organizationId: new Types.ObjectId(organizationId),
    createdByUserId: new Types.ObjectId(createdByUserId),
    updatedByUserId: new Types.ObjectId(updatedByUserId),
  };
}

export function customerConsentScope(consentId: string, organizationId: string, ticketId: string) {
  consentUuid(consentId);
  consentAccountId(organizationId);
  consentUuid(ticketId);
  return { _id: consentId, organizationId: new Types.ObjectId(organizationId), ticketId };
}
