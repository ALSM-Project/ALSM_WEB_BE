import { ConflictException } from '@nestjs/common';
import { RequireCurrentSessionService } from '../src/modules/auth/application/require-current-session.service';
import { SessionRepository } from '../src/modules/auth/domain/session.repository';
import { UserRepository } from '../src/modules/users/domain/user.repository';
import { OrganizationType } from '../src/modules/organizations/domain/organization.types';
import { SupportOrganizationDirectory } from '../src/modules/organizations/domain/support-organization-directory.port';
import {
  SupportContextEntity,
  SupportContextProps,
} from '../src/modules/support/domain/support-context.entity';
import { SupportContextRepository } from '../src/modules/support/domain/support-context.repository';
import { SupportContextUnitOfWork } from '../src/modules/support/application/support-context.ports';
import { SupportStaffAccessService } from '../src/modules/support/application/support-staff-access.service';
import { EnterSupportContextService } from '../src/modules/support/application/enter-support-context.service';
import { ExitSupportContextService } from '../src/modules/support/application/exit-support-context.service';
import { AuthorizeSupportContextReadService } from '../src/modules/support/application/authorize-support-context-read.service';
import { SearchSupportOrganizationsService } from '../src/modules/support/application/search-support-organizations.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';

export const supportUserId = '111111111111111111111111';
export const supportSessionId = '222222222222222222222222';
export const supportOrganizationId = '333333333333333333333333';
export const otherSupportOrganizationId = '444444444444444444444444';

/** In-memory orchestration fixture only. Real Mongo tests separately prove atomicity. */
export function uc66Fixture() {
  const origin = {
    userId: supportUserId,
    sessionId: supportSessionId,
    sessionVersion: 'original-generation',
  };
  const control = { time: Date.now(), failAudit: false };
  const clock = { now: () => new Date(control.time) };
  const account = { id: supportUserId, isActive: true, isLocked: false, mustChangePassword: false };
  const session = {
    id: supportSessionId,
    userId: supportUserId,
    accessVersion: origin.sessionVersion,
    expiresAt: new Date(control.time + 2 * 60 * 60 * 1000),
    revokedAt: undefined as Date | undefined,
  };
  const sessions = { findActiveByUserId: jest.fn(async () => [session]) };
  const users = { findById: jest.fn(async () => account) };
  const authority = { current: jest.fn(async () => ({ binding: 'a'.repeat(64) })) };
  const current = new RequireCurrentSessionService(
    sessions as unknown as SessionRepository,
    users as unknown as UserRepository,
  );
  const access = new SupportStaffAccessService(
    current,
    sessions as unknown as SessionRepository,
    authority,
  );
  const organization = {
    id: supportOrganizationId,
    name: 'Customer Organisation',
    type: OrganizationType.SELF_SERVICE,
    status: 'ACTIVE' as const,
  };
  const organizations: jest.Mocked<SupportOrganizationDirectory> = {
    search: jest.fn().mockResolvedValue([organization]),
    eligible: jest.fn(async (id: string, now: Date) => {
      void now;
      return id === organization.id ? organization : null;
    }),
  };
  const rows = new Map<string, SupportContextProps>();
  const audits: Parameters<AuditRepository['append']>[0][] = [];
  const transactions: SupportContextUnitOfWork = {
    async run(_resourceId, work) {
      const pending = structuredClone(rows);
      const events: typeof audits = [];
      const contexts: SupportContextRepository = {
        activeForOrigin: async (actorUserId, originalSessionId) => {
          const row = [...pending.values()].find(
            (p) =>
              p.actorUserId === actorUserId &&
              p.originalSessionId === originalSessionId &&
              p.state === 'ACTIVE',
          );
          return row ? SupportContextEntity.fromPersistence(row) : null;
        },
        scoped: async (scope) => {
          const row = pending.get(scope.id);
          return row &&
            row.actorUserId === scope.actorUserId &&
            row.originalSessionId === scope.originalSessionId &&
            row.organizationId === scope.organizationId
            ? SupportContextEntity.fromPersistence(row)
            : null;
        },
        create: async (entity) => {
          pending.set(entity.toProps().id, entity.toProps());
        },
        save: async (entity, revision) => {
          const props = entity.toProps();
          if (pending.get(props.id)?.revision !== revision)
            throw new ConflictException('TEST conflict');
          pending.set(props.id, props);
        },
      };
      const result = await work({
        contexts,
        audit: {
          append: async (event) => {
            events.push(event);
            if (control.failAudit) throw new Error('TEST audit failure');
          },
        },
      });
      rows.clear();
      for (const [id, row] of pending) rows.set(id, row);
      audits.push(...events);
      return result;
    },
  };
  return {
    origin,
    control,
    clock,
    account,
    session,
    sessions,
    users,
    current,
    authority,
    access,
    organizations,
    rows,
    audits,
    transactions,
    enter: new EnterSupportContextService(access, organizations, transactions, clock),
    exit: new ExitSupportContextService(access, transactions, clock),
    reads: new AuthorizeSupportContextReadService(access, organizations, transactions, clock),
    search: new SearchSupportOrganizationsService(access, organizations, clock),
  };
}
