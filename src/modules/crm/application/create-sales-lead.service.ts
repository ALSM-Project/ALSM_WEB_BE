import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  SALES_TEAM_ADMINISTRATION,
  SalesTeamAdministration,
} from '../../teams/domain/sales-team-administration.port';
import { SALES_UNIT_OF_WORK, SalesUnitOfWork } from './sales-unit-of-work.port';
import { evidenceReference, salesId } from './sales-validation';
export interface CreateSalesLeadCommand {
  leadId: string;
  assignmentId: string;
  teamId: string;
  salespersonId: string;
  title: string;
  sourceReference: string;
  contactEmail?: string;
}
@Injectable()
export class CreateSalesLeadService {
  constructor(
    @Inject(SALES_TEAM_ADMINISTRATION) private readonly access: SalesTeamAdministration,
    @Inject(SALES_UNIT_OF_WORK) private readonly atomic: SalesUnitOfWork,
  ) {}
  async execute(
    userId: string,
    organizationHeader: string | undefined,
    command: CreateSalesLeadCommand,
  ) {
    const leadId = salesId(command.leadId),
      teamId = salesId(command.teamId),
      salespersonId = salesId(command.salespersonId);
    const assignmentId = salesId(command.assignmentId),
      sourceReference = evidenceReference(command.sourceReference);
    const title = command.title.trim();
    if (!title || title.length > 120)
      throw new BadRequestException('A real lead title of at most 120 characters is required');
    const { organizationId } = await this.access.authorize(
      userId,
      organizationHeader,
      teamId,
      salespersonId,
    );
    return this.atomic.run(async (repositories) => {
      const lead = await repositories.leads.create({
        leadId,
        organizationId,
        actorUserId: userId,
        title,
        sourceReference,
        contactEmail: command.contactEmail?.trim(),
        assignment: {
          id: assignmentId,
          teamId,
          salespersonId,
          startedAt: new Date(),
          actorUserId: userId,
          expectedRevision: 0,
        },
      });
      await repositories.audit.append({
        actorUserId: userId,
        organizationId,
        action: lead.replayed ? 'LEAD_CREATION_RECONCILED' : 'LEAD_CREATED',
        resourceType: 'lead',
        resourceId: lead.id,
        metadata: { teamId, salespersonId, assignmentId },
      });
      return lead;
    }, leadId);
  }
}
