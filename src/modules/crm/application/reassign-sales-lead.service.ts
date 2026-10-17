import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  SALES_TEAM_ADMINISTRATION,
  SalesTeamAdministration,
} from '../../teams/domain/sales-team-administration.port';
import { SALES_UNIT_OF_WORK, SalesUnitOfWork } from './sales-unit-of-work.port';
import { expectedRevision, requireLead, requireSaved, salesId } from './sales-validation';
export interface ReassignSalesLeadCommand {
  assignmentId: string;
  teamId: string;
  salespersonId: string;
  expectedRevision: number;
}
@Injectable()
export class ReassignSalesLeadService {
  constructor(
    @Inject(SALES_TEAM_ADMINISTRATION) private readonly access: SalesTeamAdministration,
    @Inject(SALES_UNIT_OF_WORK) private readonly atomic: SalesUnitOfWork,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    selector: string,
    command: ReassignSalesLeadCommand,
  ) {
    const leadId = salesId(selector),
      teamId = salesId(command.teamId),
      salespersonId = salesId(command.salespersonId),
      assignmentId = salesId(command.assignmentId);
    const revision = expectedRevision(command.expectedRevision);
    const { organizationId } = await this.access.authorize(
      userId,
      organizationHeader,
      teamId,
      salespersonId,
    );
    return this.atomic.run(async (repositories) => {
      const previous = requireLead(await repositories.leads.findById(leadId, organizationId));
      const current = previous.assignments[previous.assignments.length - 1];
      await this.access.authorize(userId, organizationId, current.teamId);
      if (
        current.teamId === teamId &&
        current.salespersonId === salespersonId &&
        !previous.assignments.some((item) => item.id === assignmentId)
      )
        throw new BadRequestException('This salesperson already holds the active assignment');
      const lead = requireSaved(
        await repositories.leads.assign(leadId, organizationId, {
          id: assignmentId,
          teamId,
          salespersonId,
          startedAt: new Date(),
          actorUserId: userId,
          expectedRevision: revision,
        }),
      );
      await repositories.audit.append({
        actorUserId: userId,
        organizationId,
        action: lead.replayed ? 'LEAD_ASSIGNMENT_RECONCILED' : 'LEAD_REASSIGNED',
        resourceType: 'lead',
        resourceId: leadId,
        metadata: { teamId, salespersonId, assignmentId, revision: String(lead.revision) },
      });
      return lead;
    }, leadId);
  }
}
