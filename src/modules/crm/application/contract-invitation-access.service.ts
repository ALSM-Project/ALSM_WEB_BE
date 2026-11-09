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
    const userPerms = await this.permissions.getEffectivePermissions(userId);
    if (!userPerms.includes(requiredPermission)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to access Sales leads.' });
    }

    let lead: LeadRecord | null = null;
    if (organizationIdValue && /^[a-f\d]{24}$/i.test(organizationIdValue)) {
      lead = await this.leads.findById(leadId, organizationIdValue);
    }
    if (!lead) {
      lead = await this.leads.findById(leadId);
    }
    if (!lead) {
      throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead is unavailable.' });
    }

    const userFirstOrgId = (await this.organizations.findFirstForMember(userId))?.id;
    const organizationId = lead.organizationId || organizationIdValue || userFirstOrgId;
    if (!organizationId) {
      throw new ForbiddenException({ code: 'ORGANIZATION_ACCESS_DENIED', message: 'You do not have access to a Sales organization.' });
    }

    // Platform administrators or sales managers with full manage permission have access across sales leads
    const isManager = userPerms.includes('sales.leads.manage') || Boolean(user.isPlatformAdmin);
    if (isManager) {
      return { lead, organizationId };
    }

    const assignment = lead.assignments && lead.assignments.length > 0
      ? lead.assignments[lead.assignments.length - 1]
      : undefined;

    if (assignment) {
      if (assignment.salespersonId === userId) {
        return { lead, organizationId };
      }
      if (assignment.teamId && /^[a-f\d]{24}$/i.test(assignment.teamId)) {
        const team = await this.teams.findById(assignment.teamId, organizationId);
        if (
          team &&
          team.kind === TeamKind.SALES &&
          (team.memberIds.includes(userId) || team.managerIds.includes(userId))
        ) {
          return { lead, organizationId };
        }
      }
    }

    if (requiredPermission === 'sales.leads.view') {
      return { lead, organizationId };
    }

    throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead is unavailable.' });
  }

  async getContractReviewRecipients(lead: LeadRecord, organizationId: string): Promise<string[]> {
    const assignment = lead.assignments && lead.assignments.length > 0
      ? lead.assignments[lead.assignments.length - 1]
      : undefined;
    if (!assignment) return [];

    let candidates: string[] = [];
    if (assignment.teamId && /^[a-f\d]{24}$/i.test(assignment.teamId)) {
      const team = await this.teams.findById(assignment.teamId, organizationId);
      if (team && team.kind === TeamKind.SALES) {
        candidates = [...new Set([...team.managerIds, ...team.memberIds])];
      }
    }

    if (candidates.length === 0 && assignment.salespersonId) {
      try {
        const teams = await this.teams.listForSalesMember(assignment.salespersonId, organizationId);
        for (const t of teams) {
          candidates.push(...t.managerIds, ...t.memberIds);
        }
      } catch {
        // ignore fallback errors
      }
    }

    const eligible = await Promise.all([...new Set(candidates)].map(async (userId) => {
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
