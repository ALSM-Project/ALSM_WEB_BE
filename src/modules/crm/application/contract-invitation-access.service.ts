import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EffectivePermissionsService } from '../../rbac/application/effective-permissions.service';
import { isEmail } from 'class-validator';
import { USER_REPOSITORY, UserRepository } from '../../users/domain/user.repository';
import { ORGANIZATION_REPOSITORY, OrganizationRepository } from '../../organizations/domain/organization.repository';
import { TEAM_REPOSITORY, TeamKind, TeamRepository } from '../../teams/domain/team.types';
import { LEAD_REPOSITORY, LeadRecord, LeadRepository } from '../domain/lead.types';

@Injectable()
export class ContractInvitationAccessService {
  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(TEAM_REPOSITORY) private readonly teams: TeamRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly permissions: EffectivePermissionsService,
  ) {}

  async requireLeadAccess(
    userId: string,
    organizationIdValue: string | undefined,
    leadIdValue: string,
    requiredPermission = 'sales.leads.manage',
  ) {
    const leadId = this.id(leadIdValue, 'Lead');
    const user = await this.users.findById(userId);
    if (!user?.isActive) throw new ForbiddenException({ code: 'LEAD_ACCESS_DENIED', message: 'Lead is unavailable.' });
    if (!(await this.permissions.getEffectivePermissions(userId)).includes(requiredPermission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to access Sales leads.' });
    }

    const organizationIdCandidate = organizationIdValue
      ?? (await this.organizations.findFirstForMember(userId))?.id;
    if (!organizationIdCandidate) {
      throw new ForbiddenException({ code: 'ORGANIZATION_ACCESS_DENIED', message: 'You do not have access to a Sales organization.' });
    }
    const organizationId = this.id(organizationIdCandidate, 'organization');

    const organization = await this.organizations.findForMember(organizationId, userId);
    if (!organization) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead is unavailable.' });
    const lead = await this.leads.findById(leadId, organizationId);
    if (!lead) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead is unavailable.' });
    const assignment = lead.assignments[lead.assignments.length - 1];
    if (!assignment) throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead is unavailable.' });
    const team = await this.teams.findById(assignment.teamId, organizationId);
    if (
      !team ||
      team.kind !== TeamKind.SALES ||
      (assignment.salespersonId !== userId &&
        !team.memberIds.includes(userId) &&
        !team.managerIds.includes(userId))
    ) {
      throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead is unavailable.' });
    }
    return { lead, organizationId };
  }

  async getContractReviewRecipients(lead: LeadRecord, organizationId: string): Promise<string[]> {
    const assignment = lead.assignments[lead.assignments.length - 1];
    if (!assignment) return [];
    const team = await this.teams.findById(assignment.teamId, organizationId);
    if (!team || team.kind !== TeamKind.SALES) return [];
    const candidates = [...new Set([...team.managerIds, ...team.memberIds])];
    const eligible = await Promise.all(candidates.map(async (userId) => {
      const user = await this.users.findById(userId);
      if (!user?.isActive || user.isLocked) return null;
      return (await this.permissions.getEffectivePermissions(userId)).includes('sales.contracts.review') ? userId : null;
    }));
    return eligible.filter((userId): userId is string => Boolean(userId));
  }

  private id(value: string | undefined, label: string): string {
    if (!value || !/^[a-f\d]{24}$/i.test(value)) {
      throw new BadRequestException({ code: 'INVALID_IDENTIFIER', message: `A valid ${label} identifier is required.` });
    }
    return value.toLowerCase();
  }
}

export function requireLeadEmail(lead: LeadRecord): string {
  const email = lead.contactEmail?.trim().toLowerCase();
  if (!email || email.length > 254 || !isEmail(email)) {
    throw new BadRequestException({
      code: 'LEAD_CONTACT_EMAIL_REQUIRED',
      message: 'Add a valid contact email to the Lead before sending an invitation.',
    });
  }
  return email;
}
