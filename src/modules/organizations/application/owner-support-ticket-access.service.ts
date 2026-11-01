import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrganizationContextService } from './organization-context.service';
import { OrganizationAuthorizationService } from './organization-authorization.service';
import { OrganizationRole } from '../domain/organization.types';
import {
  INTERNAL_SUPPORT_ASSIGNMENT,
  InternalSupportAssignmentPort,
} from '../../rbac/domain/internal-support-assignment.port';
import type {
  SupportTicketAccessPort,
  SupportTicketAccessRequest,
} from '../../support/application/support-ticket-access.port';

/** Technical Owner-approved ordinary Ticket authority, never Support View admission. */
@Injectable()
export class OwnerSupportTicketAccessService implements SupportTicketAccessPort {
  constructor(
    private readonly context: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(INTERNAL_SUPPORT_ASSIGNMENT)
    private readonly supportAssignments: InternalSupportAssignmentPort,
  ) {}

  async authorize(input: SupportTicketAccessRequest): Promise<boolean> {
    const { actorUserId, organizationId, action } = input;
    if (
      !/^[a-f0-9]{24}$/.test(actorUserId) ||
      !/^[a-f0-9]{24}$/.test(organizationId) ||
      !['CREATE', 'READ', 'LIST', 'CLOSE', 'CANCEL', 'REOPEN'].includes(action)
    )
      return false;
    try {
      // Exact current membership, never the caller's first Organisation.
      const organization = await this.context.resolve(actorUserId, organizationId);
      if (
        organization.id !== organizationId ||
        organization.members.filter((member) => member.userId === actorUserId).length !== 1
      )
        return false;
      this.authorization.require(organization, actorUserId, [OrganizationRole.OWNER]);
      // A Support assignment is a denial, never a permission or an Admin bypass.
      return (await this.supportAssignments.hasCurrentAssignment(actorUserId)) === false;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw new ServiceUnavailableException({
        code: 'SUPPORT_TICKET_AUTHORITY_UNAVAILABLE',
        message: 'Support Ticket authority could not be verified',
      });
    }
  }
}
