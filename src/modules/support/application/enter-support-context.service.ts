import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SUPPORT_ORGANIZATION_DIRECTORY,
  SupportOrganizationDirectory,
} from '../../organizations/domain/support-organization-directory.port';
import { SupportContextEntity } from '../domain/support-context.entity';
import {
  SUPPORT_CLOCK,
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportClock,
  SupportContextUnitOfWork,
  SupportPrincipal,
} from './support-context.ports';
import { supportOperationError, supportIdentifier } from './support-context.errors';
import { SupportStaffAccessService } from './support-staff-access.service';

@Injectable()
export class EnterSupportContextService {
  constructor(
    private readonly access: SupportStaffAccessService,
    @Inject(SUPPORT_ORGANIZATION_DIRECTORY)
    private readonly organizations: SupportOrganizationDirectory,
    @Inject(SUPPORT_CONTEXT_UNIT_OF_WORK) private readonly transactions: SupportContextUnitOfWork,
    @Inject(SUPPORT_CLOCK) private readonly clock: SupportClock,
  ) {}

  async execute(
    principal: SupportPrincipal,
    organizationId: string,
  ): Promise<SupportContextEntity> {
    const actor = { ...principal };
    supportIdentifier(organizationId);
    const id = randomUUID();
    const operationId = randomUUID();
    const admission = await this.access.require(actor, this.clock.now());
    try {
      const context = await this.transactions.run(id, async ({ contexts, audit }) => {
        const now = this.clock.now();
        await this.access.recheck(actor, admission, now);
        if (!(await this.organizations.eligible(organizationId, now)))
          throw new NotFoundException({
            code: 'SUPPORT_ORGANIZATION_UNAVAILABLE',
            message: 'Organisation is unavailable for Support access',
          });
        const previous = await contexts.activeForOrigin(
          admission.actorUserId,
          admission.originalSessionId,
        );
        if (previous) {
          const props = previous.toProps();
          const obsoleteBinding =
            props.sessionVersion !== admission.sessionVersion ||
            props.authorityBinding !== admission.authorityBinding;
          if (!obsoleteBinding && previous.isActive(now))
            throw new ConflictException({
              code: 'SUPPORT_CONTEXT_ALREADY_ACTIVE',
              message: 'Exit the current Support context before entering another',
              details: [{ contextId: props.id }],
            });
          previous.end(obsoleteBinding ? 'REVOKED' : 'EXPIRED', now);
          await contexts.save(previous, props.revision);
          await audit.append({
            actorUserId: props.actorUserId,
            organizationId: props.organizationId,
            action: obsoleteBinding ? 'SUPPORT_CONTEXT_REVOKED' : 'SUPPORT_CONTEXT_EXPIRED',
            resourceType: 'SUPPORT_CONTEXT',
            resourceId: props.id,
            metadata: { originalSessionId: props.originalSessionId },
          });
        }
        const created = SupportContextEntity.create({
          id,
          ...admission,
          organizationId,
          now,
          authorityExpiresAt: admission.expiresAt,
        });
        await contexts.create(created);
        await audit.append({
          actorUserId: admission.actorUserId,
          organizationId,
          action: 'SUPPORT_CONTEXT_ENTERED',
          resourceType: 'SUPPORT_CONTEXT',
          resourceId: id,
          metadata: {
            originalSessionId: admission.originalSessionId,
            mode: 'READ_ONLY',
            contextId: id,
            operationId,
            operation: 'ENTER',
          },
        });
        await this.access.recheck(actor, admission, this.clock.now());
        if (!created.isActive(this.clock.now()))
          throw new ConflictException({
            code: 'SUPPORT_CONTEXT_INACTIVE',
            message: 'Support context expired before confirmation',
          });
        return created;
      });
      return context;
    } catch (error) {
      return supportOperationError(error, id, operationId);
    }
  }
}
