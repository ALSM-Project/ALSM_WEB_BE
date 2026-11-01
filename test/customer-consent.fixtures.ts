import { consentDataCopy } from '../src/modules/support/domain/customer-consent.validation';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { OwnerSupportTicketAccessService } from '../src/modules/organizations/application/owner-support-ticket-access.service';
import {
  OrganizationRole,
  OrganizationType,
} from '../src/modules/organizations/domain/organization.types';
import { CustomerConsentEntity } from '../src/modules/support/domain/customer-consent.entity';
import {
  CustomerConsentAudit,
  CustomerConsentRepository,
  CustomerConsentWriteOutcome,
} from '../src/modules/support/domain/customer-consent.repository';
import { SupportTicketEntity } from '../src/modules/support/domain/support-ticket.entity';
import { CustomerConsentContextService } from '../src/modules/support/application/customer-consent-context.service';
import {
  CustomerConsentActorAuthorization,
  CustomerConsentAuthorityRequest,
} from '../src/modules/support/application/customer-consent-authority.port';
import {
  RequestCustomerConsentCommand,
  RequestCustomerConsentService,
} from '../src/modules/support/application/request-customer-consent.service';
import { GetCustomerConsentStatusService } from '../src/modules/support/application/get-customer-consent-status.service';
import { TransitionCustomerConsentService } from '../src/modules/support/application/transition-customer-consent.service';
import type { CustomerConsentProps } from '../src/modules/support/domain/customer-consent.types';
import type {
  AuthorityEvidenceReference,
  AuthorityRevisionReference,
  TicketConsentBoundaryInput,
} from '../src/modules/support/domain/ticket-consent-boundary.contracts';

export const consentIds = {
  actor: '111111111111111111111111',
  organization: '222222222222222222222222',
  beneficiary: '333333333333333333333333',
  foreignOrganization: '444444444444444444444444',
  ticket: '00000000-0000-4000-8000-000000000001',
  episode: '00000000-0000-4000-8000-000000000002',
  consent: '00000000-0000-4000-8000-000000000003',
  nextEpisode: '00000000-0000-4000-8000-000000000004',
};
export const consentNow = new Date('2026-10-29T04:00:00Z');
export function consentSourceFixture(evidenceId = 'request-1'): AuthorityRevisionReference {
  return {
    authorityId: 'synthetic-customer-channel',
    evidenceId,
    revision: 'r1',
    generation: 'g1',
  };
}
export function consentEvidenceFixture(
  evidenceId = 'claim',
  status: AuthorityEvidenceReference['status'] = 'UNKNOWN',
): AuthorityEvidenceReference {
  return { ...consentSourceFixture(evidenceId), status };
}
export function consentRequestCommand(): RequestCustomerConsentCommand {
  const scope = {
    useCase: 'UC66',
    purposeId: 'diagnose',
    operation: 'UC66_READ_PROJECTS',
    projectionId: 'proposed-projection-v1',
    environmentId: 'synthetic-only',
    mode: 'READ_ONLY',
  } as const;
  return {
    actorUserId: consentIds.actor,
    organizationId: consentIds.organization,
    ticketId: consentIds.ticket,
    episodeId: consentIds.episode,
    expectedTicketRevision: 0,
    scope: { ...scope },
    proposal: {
      scope: { ...scope },
      beneficiary: {
        identity: {
          personId: 'proposed-staff-person',
          accountId: consentIds.beneficiary,
          provenance: consentEvidenceFixture('staff-person'),
        },
        ordinarySession: consentEvidenceFixture('ordinary-session-reference-only'),
        entitlement: consentEvidenceFixture('entitlement-claim'),
      },
      coverage: {
        kind: 'INDIVIDUAL',
        personId: 'proposed-staff-person',
        accountId: consentIds.beneficiary,
      },
      policy: {
        policyId: 'proposed-policy',
        version: 'v1',
        sha256: 'a'.repeat(64),
        decisionEvidence: consentEvidenceFixture('policy-claim'),
      },
    },
    source: consentSourceFixture(),
  };
}
export function consentTicketFixture() {
  return SupportTicketEntity.createNew({
    ticketId: consentIds.ticket,
    organizationId: consentIds.organization,
    episodeId: consentIds.episode,
    requesterUserId: consentIds.actor,
    purposeId: 'diagnose',
    now: new Date('2026-10-28T00:00:00Z'),
  });
}
/** Synthetic verification-port fixture only; NEVER installed in production DI. */
export function consentActorFixture(
  request: CustomerConsentAuthorityRequest,
): CustomerConsentActorAuthorization {
  return {
    request: consentDataCopy(request),
    actor: {
      personId: 'customer-owner-person',
      accountId: request.actorUserId,
      provenance: consentEvidenceFixture('owner-person', 'CURRENT'),
    },
    customerAuthority: {
      kind: 'ORGANIZATION_OWNER',
      organizationId: request.ticket.organizationId,
      evidence: consentEvidenceFixture('owner-authority', 'CURRENT'),
    },
  };
}
export function pendingConsentFixture() {
  const command = consentRequestCommand();
  return CustomerConsentEntity.request({
    consentId: consentIds.consent,
    ticket: consentTicketFixture(),
    episodeId: command.episodeId,
    proposal: command.proposal,
    grantor: {
      personId: 'customer-owner-person',
      accountId: command.actorUserId,
      provenance: consentEvidenceFixture('owner-person', 'CURRENT'),
    },
    customerAuthority: {
      kind: 'ORGANIZATION_OWNER',
      organizationId: command.organizationId,
      evidence: consentEvidenceFixture('owner-authority', 'CURRENT'),
    },
    actorUserId: command.actorUserId,
    source: command.source,
    now: consentNow,
  });
}

/** In-memory CAS/outcome fixture, not an adapter or MongoDB/atomicity evidence. */
export function consentApplicationFixture() {
  let ticket = consentTicketFixture();
  const records = new Map<string, CustomerConsentProps>();
  const audits: CustomerConsentAudit[] = [];
  const outcomes = { next: 'CONFIRMED' as CustomerConsentWriteOutcome, persistUnknown: false };
  const organization = {
    id: consentIds.organization,
    name: 'Synthetic',
    type: OrganizationType.ENTERPRISE,
    members: [{ userId: consentIds.actor, role: OrganizationRole.OWNER }],
    createdAt: consentNow,
    updatedAt: consentNow,
  };
  const organizations = {
    findForMember: jest.fn(async (org: string, actor: string) =>
      org === organization.id && organization.members.some((m) => m.userId === actor)
        ? consentDataCopy(organization)
        : null,
    ),
  };
  const staff = { hasCurrentAssignment: jest.fn().mockResolvedValue(false) };
  const owner = new OwnerSupportTicketAccessService(
    new OrganizationContextService(organizations as never),
    new OrganizationAuthorizationService(),
    staff,
  );
  const tickets = {
    create: jest.fn(),
    save: jest.fn(),
    findById: jest.fn(async (id: string, org: string) =>
      ticket.toProps().ticketId === id && ticket.toProps().organizationId === org
        ? SupportTicketEntity.fromPersistence(ticket.toProps())
        : null,
    ),
  };
  const authority = {
    authorize: jest
      .fn<Promise<CustomerConsentActorAuthorization | null>, [CustomerConsentAuthorityRequest]>()
      .mockImplementation(async (request) => consentActorFixture(request)),
  };
  function persist(consent: CustomerConsentEntity, audit: CustomerConsentAudit) {
    const result = outcomes.next;
    outcomes.next = 'CONFIRMED';
    if (result === 'CONFIRMED' || (result === 'UNCONFIRMED' && outcomes.persistUnknown)) {
      records.set(consent.toProps().consentId, consent.toProps());
      audits.push(consentDataCopy(audit));
    }
    return result;
  }
  const consents: jest.Mocked<CustomerConsentRepository> = {
    findById: jest.fn(async (id, org, ticketId) => {
      const p = records.get(id);
      return p?.organizationId === org && p.ticketId === ticketId
        ? CustomerConsentEntity.fromPersistence(p)
        : null;
    }),
    create: jest.fn(async (consent, audit) => {
      const p = consent.toProps();
      if (
        records.has(p.consentId) ||
        [...records.values()].some(
          (q) =>
            q.organizationId === p.organizationId &&
            q.ticketId === p.ticketId &&
            q.episodeId === p.episodeId &&
            q.requestSource.authorityId === p.requestSource.authorityId &&
            q.requestSource.evidenceId === p.requestSource.evidenceId,
        )
      )
        return 'CONFLICT';
      return persist(consent, audit);
    }),
    save: jest.fn(async (consent, expectedRevision, audit) => {
      const p = consent.toProps(),
        previous = records.get(p.consentId);
      if (
        !previous ||
        previous.revision !== expectedRevision ||
        previous.organizationId !== p.organizationId ||
        previous.ticketId !== p.ticketId ||
        previous.episodeId !== p.episodeId
      )
        return 'CONFLICT';
      return persist(consent, audit);
    }),
  };
  const context = new CustomerConsentContextService(tickets, owner, authority);
  return {
    tickets,
    records,
    audits,
    outcomes,
    organization,
    staff,
    owner,
    authority,
    context,
    consents,
    ticket: () => ticket,
    replaceTicket: (next: SupportTicketEntity) => {
      ticket = next;
    },
    request: new RequestCustomerConsentService(context, consents),
    status: new GetCustomerConsentStatusService(context, consents),
    transition: new TransitionCustomerConsentService(context, consents),
  };
}

export function consentBoundaryFixture(): TicketConsentBoundaryInput {
  const p = pendingConsentFixture().toProps();
  const beneficiary = consentDataCopy(p.beneficiary);
  [beneficiary.identity.provenance, beneficiary.ordinarySession, beneficiary.entitlement].forEach(
    (r) => Object.assign(r, { status: 'CURRENT' }),
  );
  const policy = consentDataCopy(p.policy);
  Object.assign(policy.decisionEvidence, { status: 'CURRENT' });
  const customer = consentEvidenceFixture('claimed-positive-consent', 'CURRENT');
  const approval = {
    ...consentEvidenceFixture('claimed-internal-approval', 'CURRENT'),
    authorityId: 'different-issuer',
  };
  const ticket = { ticketId: p.ticketId, organizationId: p.organizationId, episodeId: p.episodeId };
  const binding = {
    ticket,
    requester: beneficiary.identity,
    beneficiary,
    scope: p.scope,
    policy,
    authorityGeneration: 'generation-1',
    customerConsent: {
      authorityId: customer.authorityId,
      evidenceId: customer.evidenceId,
      revision: customer.revision,
      generation: customer.generation,
    },
    internalApproval: {
      authorityId: approval.authorityId,
      evidenceId: approval.evidenceId,
      revision: approval.revision,
      generation: approval.generation,
    },
  };
  return {
    binding,
    ticket: {
      source: 'ALSM_FIRST_PARTY_TICKET',
      identity: ticket,
      evidence: consentEvidenceFixture('ticket-reference', 'CURRENT'),
      status: 'OPEN',
    },
    customerConsent: {
      kind: 'CUSTOMER_CONSENT',
      reference: customer,
      binding,
      grantor: p.grantor,
      customerAuthority: p.customerAuthority,
    },
    internalApproval: {
      kind: 'INTERNAL_APPROVAL',
      reference: approval,
      binding,
      approver: {
        personId: 'different-approver-person',
        accountId: consentIds.actor,
        provenance: consentEvidenceFixture('approver', 'CURRENT'),
      },
      approverAuthority: consentEvidenceFixture('approver-authority', 'CURRENT'),
      customerConsent: binding.customerConsent,
    },
  };
}
