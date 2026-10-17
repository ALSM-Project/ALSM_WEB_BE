import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  SALES_TEAM_ADMINISTRATION,
  SalesTeamAdministration,
} from '../../teams/domain/sales-team-administration.port';
import { SALES_UNIT_OF_WORK, SalesUnitOfWork } from './sales-unit-of-work.port';
import {
  evidenceReference,
  expectedRevision,
  requireLead,
  requireSaved,
  salesId,
} from './sales-validation';
export interface ConvertSalesLeadCommand {
  conversionId: string;
  customerUserId: string;
  reference: string;
  expectedRevision: number;
}
@Injectable()
export class ConvertSalesLeadService {
  constructor(
    @Inject(SALES_TEAM_ADMINISTRATION) private readonly access: SalesTeamAdministration,
    @Inject(SALES_UNIT_OF_WORK) private readonly atomic: SalesUnitOfWork,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    selector: string,
    command: ConvertSalesLeadCommand,
  ) {
    const leadId = salesId(selector),
      conversionId = salesId(command.conversionId),
      customerUserId = salesId(command.customerUserId),
      reference = evidenceReference(command.reference);
    const revision = expectedRevision(command.expectedRevision);
    const { organizationId } = await this.access.organization(userId, organizationHeader);
    return this.atomic.run(async (repositories) => {
      const previous = requireLead(await repositories.leads.findById(leadId, organizationId));
      const current = previous.assignments[previous.assignments.length - 1];
      await this.access.authorize(userId, organizationId, current.teamId);
      if (!(await this.access.customer(organizationId, customerUserId)))
        throw new BadRequestException({
          code: 'CUSTOMER_ACCOUNT_REQUIRED',
          message:
            'Confirm conversion only to an existing active customer account in this organization',
        });
      const credit = previous.conversion ?? {
        assignmentId: current.id,
        teamId: current.teamId,
        salespersonId: current.salespersonId,
      };
      const lead = requireSaved(
        await repositories.leads.convert(leadId, organizationId, revision, {
          id: conversionId,
          customerUserId,
          reference,
          convertedAt: new Date(),
          actorUserId: userId,
          assignmentId: credit.assignmentId,
          teamId: credit.teamId,
          salespersonId: credit.salespersonId,
        }),
      );
      await repositories.audit.append({
        actorUserId: userId,
        organizationId,
        action: lead.replayed ? 'LEAD_CONVERSION_RECONCILED' : 'LEAD_CONVERTED_TO_CUSTOMER',
        resourceType: 'lead',
        resourceId: leadId,
        metadata: {
          conversionId,
          assignmentId: lead.conversion!.assignmentId,
          salespersonId: lead.conversion!.salespersonId,
          teamId: lead.conversion!.teamId,
        },
      });
      return lead;
    }, leadId);
  }
}
