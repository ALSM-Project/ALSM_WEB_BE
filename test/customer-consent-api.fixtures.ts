import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { InjectionToken } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { isDeepStrictEqual } from 'node:util';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { SESSION_REPOSITORY } from '../src/modules/auth/domain/session.repository';
import { USER_REPOSITORY } from '../src/modules/users/domain/user.repository';
import { SUPPORT_TICKET_ACCESS } from '../src/modules/support/application/support-ticket-access.port';
import { SUPPORT_TICKET_REPOSITORY } from '../src/modules/support/domain/support-ticket.repository';
import { CUSTOMER_CONSENT_REPOSITORY } from '../src/modules/support/domain/customer-consent.repository';
import {
  CUSTOMER_CONSENT_AUTHORITY,
  CustomerConsentAuthorityRequest,
} from '../src/modules/support/application/customer-consent-authority.port';
import { CustomerConsentContextService } from '../src/modules/support/application/customer-consent-context.service';
import { RequestCustomerConsentService } from '../src/modules/support/application/request-customer-consent.service';
import { GetCustomerConsentStatusService } from '../src/modules/support/application/get-customer-consent-status.service';
import { TransitionCustomerConsentService } from '../src/modules/support/application/transition-customer-consent.service';
import { CustomerConsentController } from '../src/modules/support/presentation/customer-consent.controller';
import type {
  RequestCustomerConsentDto,
  DeclineCustomerConsentDto,
} from '../src/modules/support/presentation/customer-consent.dto';
import { SupportTicketOwnerGuard } from '../src/modules/support/presentation/support-ticket-owner.guard';
import { ApiExceptionFilter } from '../src/shared/errors/api-exception.filter';
import {
  consentActorFixture,
  consentApplicationFixture,
  consentIds,
  consentRequestCommand,
  consentSourceFixture,
} from './customer-consent.fixtures';

export const consentHttpSecret = 'isolated-consent-http-synthetic-test-key';
export const consentHttpSession = '777777777777777777777777';
export const consentHttpBase = `/api/v1/organizations/${consentIds.organization}/support-tickets/${consentIds.ticket}/customer-consents`;
export function consentHttpRequestBody() {
  const c = consentRequestCommand();
  return {
    episodeId: c.episodeId,
    expectedTicketRevision: c.expectedTicketRevision,
    proposal: c.proposal,
    source: c.source,
  } as RequestCustomerConsentDto;
}
export function consentHttpDeclineBody(sourceId = 'decline-1') {
  const c = consentRequestCommand();
  return {
    episodeId: c.episodeId,
    expectedTicketRevision: c.expectedTicketRevision,
    expectedRevision: 0,
    scope: c.scope,
    source: consentSourceFixture(sourceId),
  } as DeclineCustomerConsentDto;
}
export function consentHttpStatusQuery() {
  const c = consentRequestCommand();
  return {
    episodeId: c.episodeId,
    expectedTicketRevision: String(c.expectedTicketRevision),
    purposeId: c.scope.purposeId,
    operation: c.scope.operation,
    projectionId: c.scope.projectionId,
    environmentId: c.scope.environmentId,
  };
}

/** Test-only approval ledger. It authenticates nothing in production and is never exported from src. */
export async function createConsentHttpFixture(
  overrides: { token: InjectionToken; value: unknown }[] = [],
  missingAuthority = false,
) {
  const f = consentApplicationFixture();
  const control = {
    active: true,
    locked: false,
    revoked: false,
    expired: false,
    sessionVersion: 'v1',
  };
  const intents = new Map<
    string,
    { action: CustomerConsentAuthorityRequest['action']; consentId?: string }
  >();
  const approve = (
    action: CustomerConsentAuthorityRequest['action'],
    sourceId: string,
    consentId?: string,
  ) => intents.set(sourceId, { action, consentId });
  f.authority.authorize.mockImplementation(async (r) => {
    const c = consentRequestCommand(),
      intent = intents.get(r.source?.evidenceId ?? `status:${r.consentId}`);
    if (
      !intent ||
      intent.action !== r.action ||
      (intent.consentId && intent.consentId !== r.consentId) ||
      r.actorUserId !== c.actorUserId ||
      !isDeepStrictEqual(r.ticket, {
        ticketId: c.ticketId,
        organizationId: c.organizationId,
        episodeId: c.episodeId,
      }) ||
      r.ticketRevision !== c.expectedTicketRevision ||
      !isDeepStrictEqual(r.scope, c.scope) ||
      (r.source && !isDeepStrictEqual(r.source, consentSourceFixture(r.source.evidenceId))) ||
      (r.action === 'REQUEST' && !isDeepStrictEqual(r.proposal, c.proposal))
    )
      return null;
    return consentActorFixture(r);
  });
  const users = {
    findById: jest.fn(async (id: string) =>
      id === consentIds.actor
        ? { id, isActive: control.active, isLocked: control.locked, mustChangePassword: false }
        : null,
    ),
  };
  const sessions = {
    findActiveByUserId: jest.fn(async () => [
      {
        id: consentHttpSession,
        userId: consentIds.actor,
        accessVersion: control.sessionVersion,
        expiresAt: new Date(Date.now() + (control.expired ? -60000 : 60000)),
        revokedAt: control.revoked ? new Date() : undefined,
      },
    ]),
  };
  let builder = Test.createTestingModule({
    controllers: [CustomerConsentController],
    providers: [
      JwtService,
      RequireCurrentSessionService,
      SupportTicketOwnerGuard,
      CustomerConsentContextService,
      RequestCustomerConsentService,
      GetCustomerConsentStatusService,
      TransitionCustomerConsentService,
      {
        provide: ConfigService,
        useValue: new ConfigService({ JWT_ACCESS_SECRET: consentHttpSecret }),
      },
      { provide: USER_REPOSITORY, useValue: users },
      { provide: SESSION_REPOSITORY, useValue: sessions },
      { provide: SUPPORT_TICKET_ACCESS, useValue: f.owner },
      { provide: SUPPORT_TICKET_REPOSITORY, useValue: f.tickets },
      { provide: CUSTOMER_CONSENT_REPOSITORY, useValue: f.consents },
      ...(missingAuthority ? [] : [{ provide: CUSTOMER_CONSENT_AUTHORITY, useValue: f.authority }]),
    ],
  });
  for (const { token, value } of overrides)
    builder = builder.overrideProvider(token).useValue(value);
  const module = await builder.compile();
  const app: INestApplication = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  const jwt = module.get(JwtService);
  const token = (extra = {}) =>
    jwt.sign(
      {
        sub: consentIds.actor,
        sid: consentHttpSession,
        sv: 'v1',
        email: 'owner@example.invalid',
        isPlatformAdmin: false,
        ...extra,
      },
      { secret: consentHttpSecret },
    );
  return { app, module, f, control, users, sessions, approve, intents, token };
}
