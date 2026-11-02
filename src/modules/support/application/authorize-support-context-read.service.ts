import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
import { supportOperationError, supportDenied, supportIdentifier } from './support-context.errors';
import { randomUUID } from 'node:crypto';
import { SupportStaffAccessService } from './support-staff-access.service';

/** Explicit allowlist, not HTTP-method inference. No customer resource operation is admitted yet. */
export const SUPPORT_READ_OPERATIONS = Object.freeze(['CONTEXT_STATUS'] as const);

@Injectable()
export class AuthorizeSupportContextReadService {
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
    contextId: string,
    operation: string,
  ): Promise<SupportContextEntity> {
    const actor = { ...principal };
    const operationId = randomUUID();
    supportIdentifier(organizationId);
    supportIdentifier(contextId, true);
    if (!(SUPPORT_READ_OPERATIONS as readonly string[]).includes(operation)) throw supportDenied();
    const admission = await this.access.require(actor, this.clock.now());
    try {
      const result = await this.transactions.run(contextId, async ({ contexts, audit }) => {
        const now = this.clock.now();
        await this.access.recheck(actor, admission, now);
        const context = await contexts.scoped({
          id: contextId,
          organizationId,
          actorUserId: admission.actorUserId,
          originalSessionId: admission.originalSessionId,
        });
        if (!context)
          throw new NotFoundException({
            code: 'SUPPORT_CONTEXT_NOT_FOUND',
            message: 'Support context is unavailable',
          });
        const props = context.toProps();
        const canCommitActivity = context.captureActivityWindow();
        if (
          props.sessionVersion !== admission.sessionVersion ||
          props.authorityBinding !== admission.authorityBinding
        )
          throw supportDenied();
        if (!(await this.organizations.eligible(organizationId, now))) throw supportDenied();
        context.activity(now);
        await contexts.save(context, props.revision);
        await audit.append({
          actorUserId: props.actorUserId,
          organizationId,
          action: 'SUPPORT_CONTEXT_READ',
          resourceType: 'SUPPORT_CONTEXT',
          resourceId: contextId,
          metadata: {
            originalSessionId: props.originalSessionId,
            operation,
            mode: 'READ_ONLY',
            contextId,
            operationId,
          },
        });
        await this.access.recheck(actor, admission, this.clock.now());
        if (!canCommitActivity(this.clock.now()))
          throw new ConflictException({
            code: 'SUPPORT_CONTEXT_INACTIVE',
            message: 'Support context expired before confirmation',
          });
        return context;
      });
      return result;
    } catch (error) {
      return supportOperationError(error, contextId, operationId);
    }
  }
}
