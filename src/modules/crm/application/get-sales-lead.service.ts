import { Inject, Injectable } from '@nestjs/common';
import {
  SALES_TEAM_ADMINISTRATION,
  SalesTeamAdministration,
} from '../../teams/domain/sales-team-administration.port';
import { LEAD_REPOSITORY, LeadRepository } from '../domain/lead.types';
import { requireLead, salesId } from './sales-validation';
@Injectable()
export class GetSalesLeadService {
  constructor(
    @Inject(SALES_TEAM_ADMINISTRATION) private readonly access: SalesTeamAdministration,
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepository,
  ) {}
  async execute(userId: string, organizationHeader: string | undefined, selector: string) {
    const { organizationId } = await this.access.organization(userId, organizationHeader);
    const lead = requireLead(await this.leads.findById(salesId(selector), organizationId));
    await this.access.authorize(
      userId,
      organizationId,
      lead.assignments[lead.assignments.length - 1].teamId,
    );
    return lead;
  }
}
