import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  SUPPORT_OPERATION_EVIDENCE,
  SupportOperationEvidence,
} from '../../audit/domain/support-operation-evidence.port';
import {
  SUPPORT_ORGANIZATION_DIRECTORY,
  SupportOrganizationDirectory,
} from '../../organizations/domain/support-organization-directory.port';
import { SUPPORT_CLOCK, SupportClock, SupportPrincipal } from './support-context.ports';
import { SUPPORT_INSPECTION, SupportInspection } from './support-inspection.port';
import { SupportStaffAccessService } from './support-staff-access.service';
import { supportDenied, supportIdentifier } from './support-context.errors';

@Injectable()
export class RecoverSupportContextService {
  constructor(
    private readonly access: SupportStaffAccessService,
    @Inject(SUPPORT_INSPECTION) private readonly inspection: SupportInspection,
    @Inject(SUPPORT_OPERATION_EVIDENCE) private readonly evidence: SupportOperationEvidence,
    @Inject(SUPPORT_ORGANIZATION_DIRECTORY)
    private readonly organizations: SupportOrganizationDirectory,
    @Inject(SUPPORT_CLOCK) private readonly clock: SupportClock,
  ) {}
  async execute(
    principal: SupportPrincipal,
    organizationId: string,
    contextId?: string,
    operationId?: string,
  ) {
    const actor = { ...principal };
    supportIdentifier(organizationId);
    if (contextId) supportIdentifier(contextId, true);
    if (operationId) supportIdentifier(operationId, true);
    if (operationId && !contextId) throw new BadRequestException({ code: 'INVALID_SUPPORT_INPUT' });
    const admission = await this.access.require(actor, this.clock.now());
    const scope = {
      organizationId,
      actorUserId: admission.actorUserId,
      originalSessionId: admission.originalSessionId,
    };
    let context = contextId
      ? await this.inspection.scoped({ ...scope, id: contextId })
      : await this.inspection.latest(scope);
    if (!context && contextId) throw new NotFoundException({ code: 'SUPPORT_CONTEXT_NOT_FOUND' });
    if (context) {
      const props = context.toProps();
      if (
        props.sessionVersion !== admission.sessionVersion ||
        props.authorityBinding !== admission.authorityBinding
      )
        throw supportDenied();
    }
    const operation =
      operationId && context
        ? await this.evidence.find({ ...scope, contextId: context.toProps().id, operationId })
        : null;
    const organization = context
      ? await this.organizations.eligible(organizationId, this.clock.now())
      : null;
    await this.access.recheck(actor, admission, this.clock.now());
    // Another instance may have exited while the durable audit evidence was read.
    if (context) {
      context = await this.inspection.scoped({ ...scope, id: context.toProps().id });
      if (!context) throw new NotFoundException({ code: 'SUPPORT_CONTEXT_NOT_FOUND' });
      if (
        context.toProps().authorityBinding !== admission.authorityBinding ||
        context.toProps().sessionVersion !== admission.sessionVersion
      )
        throw supportDenied();
    }
    const observedAt = this.clock.now();
    return {
      outcome: context ? ('FOUND' as const) : ('UNRESOLVED' as const),
      context,
      organization,
      usable: Boolean(context?.isActive(observedAt) && organization),
      operation: operationId
        ? {
            id: operationId,
            state: operation ? 'COMMITTED' : 'UNRESOLVED',
            kind: operation?.operation ?? null,
          }
        : null,
      observedAt,
    };
  }
}
