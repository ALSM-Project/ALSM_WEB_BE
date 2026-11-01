import type {
  AuthorityEvidenceReference,
  AuthorityRevisionReference,
  PersonAccountEvidenceReference,
  TicketConsentScope,
} from './ticket-consent-boundary.contracts';
import { CustomerConsentError, CustomerConsentProposal } from './customer-consent.types';

export function invalidConsent(): never {
  throw new CustomerConsentError('INVALID_CUSTOMER_CONSENT');
}

/** Detached own data only: no getters, prototypes, functions, cycles or evidence payloads. */
export function consentDataCopy<T>(input: T): T {
  function copy(value: unknown, ancestors: Set<object>): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || ancestors.has(value)) invalidConsent();
    if (value instanceof Date) {
      const milliseconds = Date.prototype.getTime.call(value);
      if (Reflect.ownKeys(value).length || !Number.isFinite(milliseconds)) invalidConsent();
      return new Date(milliseconds);
    }
    ancestors.add(value);
    try {
      const array = Array.isArray(value);
      if (
        !array &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        invalidConsent();
      const keys = Reflect.ownKeys(value).filter((key) => !(array && key === 'length'));
      if (array && (keys.length !== value.length || keys.some((key, i) => key !== String(i))))
        invalidConsent();
      const entries = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (typeof key !== 'string' || !descriptor || !('value' in descriptor)) invalidConsent();
        return [key, copy(descriptor.value, ancestors)] as const;
      });
      return array ? entries.map(([, item]) => item) : Object.fromEntries(entries);
    } finally {
      ancestors.delete(value);
    }
  }
  try {
    return copy(input, new Set()) as T;
  } catch (error) {
    if (error instanceof CustomerConsentError) throw error;
    invalidConsent();
  }
}

export function freezeConsentData<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeConsentData(child);
    Object.freeze(value);
  }
  return value;
}

export function consentShape(value: unknown, keys: readonly string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalidConsent();
}
export function consentIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 200 || !/^[^\s\p{Cc}]+$/u.test(value))
    invalidConsent();
}
export function consentAccountId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{24}$/.test(value)) invalidConsent();
}
export function consentUuid(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    invalidConsent();
}
export function consentRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalidConsent();
}
export function consentSource(value: AuthorityRevisionReference): void {
  consentShape(value, ['authorityId', 'evidenceId', 'revision', 'generation']);
  Object.values(value).forEach(consentIdentifier);
}
export function consentEvidence(value: AuthorityEvidenceReference): void {
  consentShape(value, ['authorityId', 'evidenceId', 'revision', 'generation', 'status']);
  ['authorityId', 'evidenceId', 'revision', 'generation'].forEach((key) =>
    consentIdentifier(value[key as keyof AuthorityEvidenceReference]),
  );
  if (
    !['CURRENT', 'STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'].includes(
      value.status,
    )
  )
    invalidConsent();
}
export function consentPerson(value: PersonAccountEvidenceReference): void {
  consentShape(value, ['personId', 'accountId', 'provenance']);
  consentIdentifier(value.personId);
  consentAccountId(value.accountId);
  consentEvidence(value.provenance);
}
export function consentScope(value: TicketConsentScope): void {
  consentShape(value, [
    'useCase',
    'purposeId',
    'operation',
    'projectionId',
    'environmentId',
    'mode',
  ]);
  if (
    value.useCase !== 'UC66' ||
    value.mode !== 'READ_ONLY' ||
    !['UC66_READ_PROJECTS', 'UC66_READ_SCREENS', 'UC66_READ_PROGRAMS', 'UC66_READ_LOGS'].includes(
      value.operation,
    )
  )
    invalidConsent();
  consentIdentifier(value.purposeId);
  consentIdentifier(value.projectionId);
  consentIdentifier(value.environmentId);
}
export function consentProposal(value: CustomerConsentProposal): void {
  consentShape(value, ['scope', 'beneficiary', 'coverage', 'policy']);
  consentScope(value.scope);
  consentShape(value.beneficiary, ['identity', 'ordinarySession', 'entitlement']);
  consentPerson(value.beneficiary.identity);
  consentEvidence(value.beneficiary.ordinarySession);
  consentEvidence(value.beneficiary.entitlement);
  consentShape(value.coverage, ['kind', 'personId', 'accountId']);
  if (
    value.coverage.kind !== 'INDIVIDUAL' ||
    value.coverage.personId !== value.beneficiary.identity.personId ||
    value.coverage.accountId !== value.beneficiary.identity.accountId
  )
    invalidConsent();
  consentShape(value.policy, ['policyId', 'version', 'sha256', 'decisionEvidence']);
  consentIdentifier(value.policy.policyId);
  consentIdentifier(value.policy.version);
  if (typeof value.policy.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.policy.sha256))
    invalidConsent();
  consentEvidence(value.policy.decisionEvidence);
}
