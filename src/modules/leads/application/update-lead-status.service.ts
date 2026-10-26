import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isAllowedLeadStatusTransition,
  LEAD_REPOSITORY,
  LeadRecord,
  LeadRepository,
  LeadStatus,
  UpdateLeadStatusOptions,
} from '../domain/lead.types';
import {
  AUDIT_REPOSITORY,
  AuditRepository,
} from '../../audit/domain/audit.repository';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

export interface UpdateLeadStatusResult {
  lead: LeadRecord;
  updated: boolean;
  message: string;
}

@Injectable()
export class UpdateLeadStatusService {
  private readonly logger = new Logger(UpdateLeadStatusService.name);

  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(
    id: string,
    newStatus: LeadStatus,
    notes?: string,
    actor?: AuthenticatedUser,
  ): Promise<UpdateLeadStatusResult> {
    // 1. Validate identifier
    if (!id || !id.match(/^[a-f\d]{24}$/i)) {
      throw new BadRequestException({
        code: 'INVALID_LEAD_ID',
        message: 'Lead ID must be a valid 24-character hexadecimal string',
      });
    }

    // 2. Validate status enum
    if (!newStatus || !Object.values(LeadStatus).includes(newStatus)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `Invalid lead status. Allowed values: ${Object.values(LeadStatus).join(', ')}`,
      });
    }

    // 3. Find lead
    const lead = await this.leads.findById(id);
    if (!lead) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: `Lead with ID ${id} not found`,
      });
    }

    // 4. Idempotency: same status request
    if (lead.status === newStatus) {
      this.logger.log(
        `Lead status already '${newStatus}' for leadId=${id} – returning current state without update`,
      );
      // If notes are supplied, optionally update them even if status is unchanged
      if (notes !== undefined && notes.trim() !== (lead.notes || '')) {
        const updated = await this.leads.updateStatus(id, newStatus, {
          notes: notes.trim(),
        });
        return {
          lead: updated ?? lead,
          updated: true,
          message: `Lead notes updated successfully (status remains ${newStatus})`,
        };
      }
      return {
        lead,
        updated: false,
        message: `Lead is already in ${newStatus} status`,
      };
    }

    // 5. Allowed status transition validation
    if (!isAllowedLeadStatusTransition(lead.status, newStatus)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot transition lead from ${lead.status} to ${newStatus}`,
      });
    }

    // 6. Build update options
    const options: UpdateLeadStatusOptions = {};
    if (notes !== undefined && notes !== null) {
      options.notes = notes.trim();
    }
    if (newStatus === LeadStatus.CONTACTED && !lead.lastContactedAt) {
      options.lastContactedAt = new Date();
    }

    // 7. Persist transition
    const updated = await this.leads.updateStatus(id, newStatus, options);
    if (!updated) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: `Lead with ID ${id} could not be updated`,
      });
    }

    // 8. Auditing and logging
    this.logger.log(
      `Lead status updated – leadId=${id}, company="${lead.companyName}", previousStatus=${lead.status}, newStatus=${newStatus}, actor=${actor?.email ?? 'system'}`,
    );

    await this.audit.append({
      actorUserId: actor?.userId,
      action: 'LEAD_STATUS_UPDATED',
      resourceType: 'LEAD',
      resourceId: updated.id,
      metadata: {
        previousStatus: lead.status,
        newStatus: updated.status,
        actorEmail: actor?.email ?? '',
      },
    });

    return {
      lead: updated,
      updated: true,
      message: `Lead status updated to ${newStatus} successfully`,
    };
  }
}
