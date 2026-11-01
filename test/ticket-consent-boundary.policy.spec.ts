import type {
  AuthorityEvidenceReference,
  AuthorityRevisionReference,
  CustomerConsentReference,
  IndependentInternalApprovalReference,
  PersonAccountEvidenceReference,
  TicketConsentBinding,
  TicketConsentBoundaryInput,
  TicketConsentDenialReason,
  TicketConsentOperation,
} from '../src/modules/support/domain/ticket-consent-boundary.contracts';
import { validateTicketConsentBoundary } from '../src/modules/support/domain/ticket-consent-boundary.policy';

// Negative-only U specification. Execution requires separately authorized offline
// isolation and QA/security concurrence. Fixtures are invented reference strings,
// never authenticated people, accepted decisions, credentials or real sessions.
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type SyntheticEnvelope = Mutable<TicketConsentBoundaryInput> & {
  customerConsent: Mutable<CustomerConsentReference>;
  internalApproval: Mutable<IndependentInternalApprovalReference>;
};

/** Invented JSON data only; keep copies in the test's realm, not the Node host's. */
function cloneSyntheticData<T>(value: T): Mutable<T> {
  return JSON.parse(JSON.stringify(value)) as Mutable<T>;
}

function evidence(
  evidenceId: string,
  authorityId = 'synthetic-authority',
): Mutable<AuthorityEvidenceReference> {
  return {
    authorityId,
    evidenceId,
    revision: 'synthetic-revision-a',
    generation: 'synthetic-generation-a',
    status: 'CURRENT',
  };
}

function revision(reference: AuthorityEvidenceReference): Mutable<AuthorityRevisionReference> {
  return {
    authorityId: reference.authorityId,
    evidenceId: reference.evidenceId,
    revision: reference.revision,
    generation: reference.generation,
  };
}

function person(suffix: string): Mutable<PersonAccountEvidenceReference> {
  return {
    personId: `synthetic-person-${suffix}`,
    accountId: `synthetic-account-${suffix}`,
    provenance: evidence(`synthetic-person-binding-${suffix}`),
  };
}

/** Structurally consistent claims remain unauthenticated and must still DENY. */
function syntheticEnvelope(): SyntheticEnvelope {
  const requester = person('requester');
  const consent = evidence('synthetic-consent', 'synthetic-customer-authority');
  const approval = evidence('synthetic-approval', 'synthetic-internal-authority');
  const binding: Mutable<TicketConsentBinding> = {
    ticket: {
      ticketId: 'synthetic-ticket',
      organizationId: 'synthetic-organization',
      episodeId: 'synthetic-episode-a',
    },
    requester,
    beneficiary: {
      identity: cloneSyntheticData(requester),
      ordinarySession: evidence('synthetic-ordinary-session-reference'),
      entitlement: evidence('synthetic-individual-entitlement-reference'),
    },
    scope: {
      useCase: 'UC66',
      purposeId: 'synthetic-purpose',
      operation: 'UC66_READ_PROJECTS',
      projectionId: 'synthetic-unapproved-projection',
      environmentId: 'synthetic-offline-environment',
      mode: 'READ_ONLY',
    },
    policy: {
      policyId: 'synthetic-unapproved-policy',
      version: 'synthetic-version-a',
      sha256: 'a'.repeat(64),
      decisionEvidence: evidence('synthetic-unsigned-policy-reference'),
    },
    authorityGeneration: 'synthetic-authority-generation-a',
    customerConsent: revision(consent),
    internalApproval: revision(approval),
  };
  return {
    binding,
    ticket: {
      source: 'ALSM_FIRST_PARTY_TICKET',
      identity: cloneSyntheticData(binding.ticket),
      evidence: evidence('synthetic-ticket-reference'),
      status: 'OPEN',
    },
    customerConsent: {
      kind: 'CUSTOMER_CONSENT',
      reference: consent,
      binding: cloneSyntheticData(binding),
      grantor: person('customer'),
      customerAuthority: {
        kind: 'ORGANIZATION_OWNER',
        organizationId: binding.ticket.organizationId,
        evidence: evidence('synthetic-customer-authority-reference'),
      },
    },
    internalApproval: {
      kind: 'INTERNAL_APPROVAL',
      reference: approval,
      binding: cloneSyntheticData(binding),
      approver: person('approver'),
      approverAuthority: evidence('synthetic-approver-authority-reference'),
      customerConsent: revision(consent),
    },
  };
}

function expectDenied(input: unknown, reason: TicketConsentDenialReason): void {
  const denial = validateTicketConsentBoundary(input);
  expect(denial).toEqual({ outcome: 'DENY', operationalAccess: false, reason });
  expect(Object.isFrozen(denial)).toBe(true);
}

describe('S1 TC A negative-only ticket consent boundary (N01–N12)', () => {
  describe('N01 — policy references cannot establish formal approval', () => {
    it.each(['policyId', 'version', 'sha256', 'decisionEvidence'] as const)(
      'rejects missing policy %s',
      (field) => {
        const input = syntheticEnvelope();
        Reflect.deleteProperty(input.binding.policy, field);
        expectDenied(input, 'MALFORMED_INPUT');
      },
    );
    it.each(['', 'not-a-hash', 'a'.repeat(63), 'g'.repeat(64)])(
      'rejects malformed policy hash %s',
      (hash) => {
        const input = syntheticEnvelope();
        input.binding.policy.sha256 = hash;
        expectDenied(input, 'MALFORMED_INPUT');
      },
    );
    it.each(['version', 'sha256'] as const)('rejects mismatched policy %s', (field) => {
      const input = syntheticEnvelope();
      input.internalApproval.binding.policy[field] =
        field === 'sha256' ? 'b'.repeat(64) : 'other-version';
      expectDenied(input, 'POLICY_MISMATCH');
    });
    it('denies a mutable, unsigned, unapproved but well-shaped policy', () => {
      const input = syntheticEnvelope();
      expect(Object.isFrozen(input.binding.policy)).toBe(false);
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
    });
  });

  describe('N02 — flags and fabricated evidence never create authority', () => {
    it.each(['verified', 'approved', 'readOnly', 'isPlatformAdmin'])(
      'rejects caller-supplied %s at every authority boundary',
      (flag) => {
        const targets = [
          (input: SyntheticEnvelope) => input,
          (input: SyntheticEnvelope) => input.binding.policy,
          (input: SyntheticEnvelope) => input.binding.requester.provenance,
          (input: SyntheticEnvelope) => input.customerConsent,
          (input: SyntheticEnvelope) => input.internalApproval,
        ];
        for (const target of targets) {
          const input = syntheticEnvelope();
          Reflect.set(target(input), flag, true);
          expectDenied(input, 'MALFORMED_INPUT');
        }
      },
    );
    it('denies consistent frozen claims without mutating or authenticating them', () => {
      const input = syntheticEnvelope();
      Object.freeze(input.binding.policy);
      const before = JSON.stringify(input);
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
      expect(JSON.stringify(input)).toBe(before);
    });
    it.each([undefined, null, false, 1, 'synthetic-input', [], {}, { binding: null }])(
      'fails closed for malformed input %#',
      (input) => expectDenied(input, 'MALFORMED_INPUT'),
    );
    it('rejects inherited fields and accessors without evaluating getters', () => {
      const input = syntheticEnvelope();
      expectDenied(Object.create(input), 'MALFORMED_INPUT');
      const getter = jest.fn(() => input.binding);
      Object.defineProperty(input, 'binding', { get: getter });
      expectDenied(input, 'MALFORMED_INPUT');
      expect(getter).not.toHaveBeenCalled();
    });
    it('sanitizes malformed proxy failures', () => {
      const input = new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('synthetic-error');
          },
        },
      );
      expectDenied(input, 'MALFORMED_INPUT');
    });
    it('compares Proxy data descriptors without invoking property get traps', () => {
      const input = syntheticEnvelope();
      const get = jest.fn(() => {
        throw new Error('synthetic-get-trap');
      });
      input.customerConsent.binding.ticket = new Proxy(input.customerConsent.binding.ticket, {
        get,
      });
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
      expect(get).not.toHaveBeenCalled();
    });
    it('rejects an accessor installed after its shape check without invoking it', () => {
      const input = syntheticEnvelope();
      const getter = jest.fn(() => 'synthetic-ticket');
      input.customerConsent.binding.ticket = new Proxy(input.customerConsent.binding.ticket, {
        getOwnPropertyDescriptor: (target, key) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          if (key === 'episodeId') {
            Object.defineProperty(target, 'ticketId', { get: getter, configurable: true });
          }
          return descriptor;
        },
      });
      expectDenied(input, 'TICKET_SCOPE_MISMATCH');
      expect(getter).not.toHaveBeenCalled();
    });
    it('rechecks descriptors even when both sides are the same object', () => {
      const input = syntheticEnvelope();
      const bindings = [
        input.binding,
        input.customerConsent.binding,
        input.internalApproval.binding,
      ];
      const getter = jest.fn(() => 'synthetic-ticket');
      let captures = 0;
      const identity = new Proxy(input.ticket.identity, {
        getOwnPropertyDescriptor: (target, key) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          // Install the accessor after the final shared identity shape check.
          if (key === 'episodeId' && ++captures === bindings.length + 1) {
            Object.defineProperty(target, 'ticketId', { get: getter, configurable: true });
          }
          return descriptor;
        },
      });
      input.ticket.identity = identity;
      for (const binding of bindings) binding.ticket = identity;
      expectDenied(input, 'TICKET_SCOPE_MISMATCH');
      expect(getter).not.toHaveBeenCalled();
    });
    it('rejects cycles introduced after shape checks without recursive overflow', () => {
      const input = syntheticEnvelope();
      const lateCycle = (identity: Mutable<TicketConsentBinding['ticket']>) =>
        new Proxy(identity, {
          getOwnPropertyDescriptor: (target, key) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
            if (key === 'episodeId') Reflect.set(target, 'ticketId', target);
            return descriptor;
          },
        });
      input.binding.ticket = lateCycle(input.binding.ticket);
      input.ticket.identity = lateCycle(input.ticket.identity);
      expectDenied(input, 'TICKET_SCOPE_MISMATCH');
    });
    it.each(['prototype', 'descriptor', 'revoked'] as const)(
      'sanitizes a hostile %s Proxy',
      (kind) => {
        const input = syntheticEnvelope();
        const fail = () => {
          throw new Error('synthetic-proxy-failure');
        };
        if (kind === 'revoked') {
          const proxy = Proxy.revocable(input, {});
          proxy.revoke();
          expectDenied(proxy.proxy, 'MALFORMED_INPUT');
        } else {
          expectDenied(
            new Proxy(
              input,
              kind === 'prototype' ? { getPrototypeOf: fail } : { getOwnPropertyDescriptor: fail },
            ),
            'MALFORMED_INPUT',
          );
        }
      },
    );
  });

  describe('N03 — provenance is mandatory and reference shape supplies no trust', () => {
    it.each(['authorityId', 'evidenceId', 'revision', 'generation'] as const)(
      'rejects absent provenance %s',
      (field) => {
        const input = syntheticEnvelope();
        Reflect.deleteProperty(input.customerConsent.grantor.provenance, field);
        expectDenied(input, 'MALFORMED_INPUT');
      },
    );
    it('rejects missing person provenance', () => {
      const input = syntheticEnvelope();
      Reflect.deleteProperty(input.customerConsent.grantor, 'provenance');
      expectDenied(input, 'MALFORMED_INPUT');
    });
    it('denies unknown/forged issuer and verifier references even when well-shaped', () => {
      const input = syntheticEnvelope();
      input.customerConsent.grantor.provenance.authorityId = 'synthetic-unsupported-issuer';
      input.customerConsent.grantor.provenance.evidenceId = 'synthetic-forged-verification';
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
    });
  });

  describe('N04 — exact first-party Ticket, Organisation and episode are mandatory', () => {
    it.each(['ticketId', 'organizationId', 'episodeId'] as const)(
      'rejects absent or mismatched %s in each binding',
      (field) => {
        for (const target of ['request', 'ticket', 'consent', 'approval'] as const) {
          for (const missing of [true, false]) {
            const input = syntheticEnvelope();
            const identity = {
              request: input.binding.ticket,
              ticket: input.ticket.identity,
              consent: input.customerConsent.binding.ticket,
              approval: input.internalApproval.binding.ticket,
            }[target];
            if (missing) Reflect.deleteProperty(identity, field);
            else identity[field] = 'synthetic-foreign-identity';
            expectDenied(input, missing ? 'MALFORMED_INPUT' : 'TICKET_SCOPE_MISMATCH');
          }
        }
      },
    );
    it('rejects customer authority from another Organisation', () => {
      const input = syntheticEnvelope();
      input.customerConsent.customerAuthority.organizationId = 'synthetic-other-organization';
      expectDenied(input, 'TICKET_SCOPE_MISMATCH');
    });
    it('rejects an external/caller-selected Ticket source', () => {
      const input = syntheticEnvelope();
      Reflect.set(input.ticket, 'source', 'synthetic-external-source');
      expectDenied(input, 'MALFORMED_INPUT');
    });
  });

  describe('N05 — terminal episodes never restore eligibility', () => {
    it.each(['CLOSED', 'CANCELLED', 'UNKNOWN'] as const)('denies %s Tickets', (status) => {
      const input = syntheticEnvelope();
      input.ticket.status = status;
      expectDenied(input, 'TERMINAL_OR_UNKNOWN_TICKET');
    });
    it('rejects old decisions after the business Ticket reopens in a new episode', () => {
      const input = syntheticEnvelope();
      input.ticket.identity.episodeId = 'synthetic-reopened-episode';
      input.binding.ticket.episodeId = 'synthetic-reopened-episode';
      expectDenied(input, 'TICKET_SCOPE_MISMATCH');
    });
    it('denies a reopened-looking coherent envelope carrying retained terminal evidence', () => {
      const input = syntheticEnvelope();
      input.customerConsent.reference.status = 'INVALIDATED';
      expectDenied(input, 'TERMINAL_OR_UNKNOWN_REFERENCE');
    });
  });

  describe('N06 — person separation includes multiple accounts', () => {
    it.each(['synthetic-account-requester', 'synthetic-second-account'])(
      'rejects the requester person approving through %s',
      (accountId) => {
        const input = syntheticEnvelope();
        input.internalApproval.approver.personId = input.binding.requester.personId;
        input.internalApproval.approver.accountId = accountId;
        expectDenied(input, 'REQUESTER_APPROVER_SAME_PERSON');
      },
    );
    it('rejects missing person equivalence and denies distinct unverified person claims', () => {
      const input = syntheticEnvelope();
      Reflect.deleteProperty(input.internalApproval.approver, 'personId');
      expectDenied(input, 'MALFORMED_INPUT');
      expectDenied(syntheticEnvelope(), 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
    });
  });

  describe('N07 — individual beneficiary evidence is non-transferable', () => {
    it.each(['personId', 'accountId'] as const)('rejects another beneficiary %s', (field) => {
      const input = syntheticEnvelope();
      input.binding.beneficiary.identity[field] = 'synthetic-other-staff';
      expectDenied(input, 'BENEFICIARY_MISMATCH');
    });
    it.each(['consent', 'approval'] as const)(
      'rejects %s beneficiary, session and entitlement reuse',
      (decision) => {
        for (const field of ['identity', 'ordinarySession', 'entitlement'] as const) {
          const input = syntheticEnvelope();
          const beneficiary =
            decision === 'consent'
              ? input.customerConsent.binding.beneficiary
              : input.internalApproval.binding.beneficiary;
          if (field === 'identity') beneficiary.identity = person('other-staff');
          else beneficiary[field].evidenceId = 'synthetic-other-staff-reference';
          expectDenied(input, 'BENEFICIARY_MISMATCH');
        }
      },
    );
  });

  describe('N08 — customer consent and internal approval are separate mandatory decisions', () => {
    it('denies neither, customer-only and internal-only decisions', () => {
      const input = syntheticEnvelope();
      expectDenied(
        { ...input, customerConsent: null, internalApproval: null },
        'MISSING_CUSTOMER_CONSENT',
      );
      expectDenied({ ...input, customerConsent: null }, 'MISSING_CUSTOMER_CONSENT');
      expectDenied({ ...input, internalApproval: null }, 'MISSING_INTERNAL_APPROVAL');
    });
    it('rejects substituted or combined decision records', () => {
      const input = syntheticEnvelope();
      expectDenied({ ...input, internalApproval: input.customerConsent }, 'MALFORMED_INPUT');
      expectDenied({ ...input, customerConsent: input.internalApproval }, 'MALFORMED_INPUT');
      expectDenied(
        { ...input, internalApproval: { ...input.customerConsent, ...input.internalApproval } },
        'MALFORMED_INPUT',
      );
    });
    it('rejects reuse of one source decision under two kinds or revisions', () => {
      const input = syntheticEnvelope();
      input.internalApproval.reference = {
        ...input.customerConsent.reference,
        revision: 'synthetic-other-revision',
      };
      expectDenied(input, 'DISTINCT_DECISIONS_REQUIRED');
    });
  });

  describe('N09 — customer contact assertions do not establish Owner/delegate authority', () => {
    it.each(['TICKET_SUBMITTER', 'MEMBER', 'CONTACT', 'DOMAIN_MATCH'])(
      'rejects %s as authority',
      (kind) => {
        const input = syntheticEnvelope();
        Reflect.set(input.customerConsent.customerAuthority, 'kind', kind);
        expectDenied(input, 'MALFORMED_INPUT');
      },
    );
    it('rejects missing authority evidence', () => {
      const input = syntheticEnvelope();
      Reflect.deleteProperty(input.customerConsent.customerAuthority, 'evidence');
      expectDenied(input, 'MALFORMED_INPUT');
    });
    it.each(['ORGANIZATION_OWNER', 'AUTHORIZED_REPRESENTATIVE'] as const)(
      'denies an unauthenticated %s reference',
      (kind) => {
        const input = syntheticEnvelope();
        input.customerConsent.customerAuthority.kind = kind;
        expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
      },
    );
  });

  describe('N10 — every immutable actor, scope and decision binding must match', () => {
    it.each(['personId', 'accountId'] as const)('rejects mismatched requester %s', (field) => {
      const input = syntheticEnvelope();
      input.internalApproval.binding.requester[field] = 'synthetic-other-actor';
      expectDenied(input, 'BINDING_MISMATCH');
    });
    it.each(['purposeId', 'operation', 'projectionId', 'environmentId'] as const)(
      'rejects mismatched %s',
      (field) => {
        const input = syntheticEnvelope();
        Reflect.set(
          input.customerConsent.binding.scope,
          field,
          field === 'operation' ? 'UC66_READ_LOGS' : 'synthetic-other-scope',
        );
        expectDenied(input, 'BINDING_MISMATCH');
      },
    );
    it.each(['authorityId', 'evidenceId', 'revision', 'generation'] as const)(
      'rejects mismatched decision reference %s',
      (field) => {
        for (const decision of ['consent', 'approval', 'approvalConsent'] as const) {
          const input = syntheticEnvelope();
          const reference = {
            consent: input.customerConsent.reference,
            approval: input.internalApproval.reference,
            approvalConsent: input.internalApproval.customerConsent,
          }[decision];
          reference[field] = 'synthetic-other-reference';
          expectDenied(input, 'REFERENCE_MISMATCH');
        }
      },
    );
    it('rejects mismatched requested consent/approval references within a decision binding', () => {
      for (const decision of ['customerConsent', 'internalApproval'] as const) {
        const input = syntheticEnvelope();
        input.internalApproval.binding[decision].revision = 'synthetic-other-revision';
        expectDenied(input, 'BINDING_MISMATCH');
      }
    });
    it('rejects mismatched non-enumerable fields as well', () => {
      const input = syntheticEnvelope();
      Object.defineProperty(input.internalApproval.binding.scope, 'purposeId', {
        value: 'synthetic-hidden-other-purpose',
        enumerable: false,
      });
      expectDenied(input, 'BINDING_MISMATCH');
    });
  });

  describe('N11 — stale, unknown and terminal references/generations cannot reset', () => {
    it.each(['STALE', 'REVOKED', 'EXPIRED', 'INVALIDATED', 'SUPERSEDED', 'UNKNOWN'] as const)(
      'denies %s evidence at every retained authority dependency',
      (status) => {
        const input = syntheticEnvelope();
        const bindings = [
          input.binding,
          input.customerConsent.binding,
          input.internalApproval.binding,
        ];
        // Keep copied bindings consistent so each case reaches the status check,
        // rather than passing only because an earlier mismatch already denied.
        const dependencies = [
          bindings.flatMap((binding) => [
            binding.requester.provenance,
            binding.beneficiary.identity.provenance,
          ]),
          bindings.map((binding) => binding.beneficiary.ordinarySession),
          bindings.map((binding) => binding.beneficiary.entitlement),
          bindings.map((binding) => binding.policy.decisionEvidence),
          [input.ticket.evidence],
          [input.customerConsent.reference],
          [input.customerConsent.grantor.provenance],
          [input.customerConsent.customerAuthority.evidence],
          [input.internalApproval.reference],
          [input.internalApproval.approver.provenance],
          [input.internalApproval.approverAuthority],
        ];
        for (const references of dependencies) {
          for (const reference of references) reference.status = status;
          expectDenied(
            input,
            status === 'STALE' ? 'STALE_REFERENCE' : 'TERMINAL_OR_UNKNOWN_REFERENCE',
          );
          for (const reference of references) reference.status = 'CURRENT';
        }
      },
    );
    it.each(['STALE', 'REVOKED'] as const)(
      'classifies %s evidence without clock arithmetic',
      (status) => {
        const input = syntheticEnvelope();
        input.ticket.evidence.status = status;
        expectDenied(
          input,
          status === 'STALE' ? 'STALE_REFERENCE' : 'TERMINAL_OR_UNKNOWN_REFERENCE',
        );
      },
    );
    it.each(['', ' ', null, undefined, 0])(
      'rejects absent/malformed generation %#',
      (generation) => {
        const input = syntheticEnvelope();
        Reflect.set(input.binding, 'authorityGeneration', generation);
        expectDenied(input, 'MALFORMED_INPUT');
      },
    );
    it('rejects stale authority generation bindings and never trusts coherent reset claims', () => {
      const input = syntheticEnvelope();
      input.internalApproval.binding.authorityGeneration = 'synthetic-old-generation';
      expectDenied(input, 'BINDING_MISMATCH');
      for (const binding of [
        input.binding,
        input.customerConsent.binding,
        input.internalApproval.binding,
      ]) {
        binding.authorityGeneration = 'synthetic-claimed-reset-generation';
      }
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
    });
  });

  describe('N12 — UC-66 references confer no customer write or UC-67 authority', () => {
    it.each<TicketConsentOperation>([
      'CUSTOMER_BUSINESS_MUTATION',
      'UC67_MAPPING_CHANGE',
      'UC67_RETRY_CONVERSION',
    ])('rejects %s in every scope', (operation) => {
      for (const target of ['request', 'consent', 'approval'] as const) {
        const input = syntheticEnvelope();
        const binding = {
          request: input.binding,
          consent: input.customerConsent.binding,
          approval: input.internalApproval.binding,
        }[target];
        binding.scope.operation = operation;
        expectDenied(input, 'FORBIDDEN_OPERATION');
      }
    });
    it('rejects a UC-67 audience and customer-write mode', () => {
      const input = syntheticEnvelope();
      input.binding.scope.useCase = 'UC67';
      expectDenied(input, 'FORBIDDEN_OPERATION');
      input.binding.scope.useCase = 'UC66';
      input.binding.scope.mode = 'CUSTOMER_WRITE';
      expectDenied(input, 'FORBIDDEN_OPERATION');
      input.binding.scope.mode = 'READ_ONLY';
      Reflect.set(input, 'readOnly', false);
      expectDenied(input, 'MALFORMED_INPUT');
    });
    it.each<TicketConsentOperation>([
      'UC66_READ_PROJECTS',
      'UC66_READ_SCREENS',
      'UC66_READ_PROGRAMS',
      'UC66_READ_LOGS',
    ])('still denies a coherent %s envelope without trusted providers', (operation) => {
      const input = syntheticEnvelope();
      for (const binding of [
        input.binding,
        input.customerConsent.binding,
        input.internalApproval.binding,
      ]) {
        binding.scope.operation = operation;
      }
      expectDenied(input, 'EVIDENCE_NOT_INDEPENDENTLY_VERIFIED');
    });
  });
});
