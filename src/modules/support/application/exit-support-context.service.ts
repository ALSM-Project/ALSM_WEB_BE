import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupportContextEntity } from '../domain/support-context.entity';
import {
  SUPPORT_CLOCK,
  SUPPORT_CONTEXT_UNIT_OF_WORK,
  SupportClock,
  SupportContextUnitOfWork,
  SupportPrincipal,
} from './support-context.ports';
import { mapSupportContextError, supportDenied, supportIdentifier } from './support-context.errors';
import { SupportStaffAccessService } from './support-staff-access.service';

@Injectable()
export class ExitSupportContextService {
  constructor(
    private readonly access: SupportStaffAccessService,
    @Inject(SUPPORT_CONTEXT_UNIT_OF_WORK) private readonly transactions: SupportContextUnitOfWork,
    @Inject(SUPPORT_CLOCK) private readonly clock: SupportClock,
  ) {}

  async execute(
    principal: SupportPrincipal,
    organizationId: string,
    contextId: string,
  ): Promise<SupportContextEntity> {
    const actor = { ...principal };
    supportIdentifier(organizationId);
    supportIdentifier(contextId, true);
    const admission = await this.access.require(actor, this.clock.now());
    try {
      return await this.transactions.run(contextId, async ({ contexts, audit }) => {
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
        if (
          props.sessionVersion !== admission.sessionVersion ||
          props.authorityBinding !== admission.authorityBinding
        )
          throw supportDenied();
        if (context.end('EXITED', now)) {
          await contexts.save(context, props.revision);
          await audit.append({
            actorUserId: props.actorUserId,
            organizationId,
            action: 'SUPPORT_CONTEXT_EXITED',
            resourceType: 'SUPPORT_CONTEXT',
            resourceId: contextId,
            metadata: { originalSessionId: props.originalSessionId, mode: 'READ_ONLY' },
          });
        }
        await this.access.recheck(actor, admission, this.clock.now());
        return context;
      });
    } catch (error) {
      return mapSupportContextError(error);
    }
  }
}
