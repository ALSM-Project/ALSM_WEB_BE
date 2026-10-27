import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  LEAD_REPOSITORY,
  LeadQuoteItem,
  LeadRecord,
  LeadRepository,
  LeadStatus,
} from '../domain/lead.types';
import {
  AUDIT_REPOSITORY,
  AuditRepository,
} from '../../audit/domain/audit.repository';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { SendQuoteDto } from '../presentation/lead.dto';

export interface SendQuoteResult {
  quote: LeadQuoteItem;
  lead: LeadRecord;
  message: string;
}

@Injectable()
export class SendQuoteService {
  private readonly logger = new Logger(SendQuoteService.name);

  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(
    id: string,
    dto: SendQuoteDto,
    actor?: AuthenticatedUser,
  ): Promise<SendQuoteResult> {
    // 1. Validate identifier
    if (!id || !id.match(/^[a-f\d]{24}$/i)) {
      throw new BadRequestException({
        code: 'INVALID_LEAD_ID',
        message: 'Lead ID must be a valid 24-character hexadecimal string',
      });
    }

    // 2. Validate planName
    if (!dto.planName || !dto.planName.trim()) {
      throw new BadRequestException({
        code: 'INVALID_PLAN_NAME',
        message: 'Plan name cannot be empty',
      });
    }

    // 3. Validate base amount
    if (typeof dto.amount !== 'number' || isNaN(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException({
        code: 'INVALID_AMOUNT',
        message: 'Quote amount must be a positive number greater than 0',
      });
    }

    // 4. Validate discount
    const discount = dto.discountPercent ?? 0;
    if (discount < 0 || discount > 100) {
      throw new BadRequestException({
        code: 'INVALID_DISCOUNT',
        message: 'Discount percent must be between 0 and 100',
      });
    }

    // Discounts > 15% require an explicit justification
    if (discount > 15 && (!dto.discountReason || !dto.discountReason.trim())) {
      throw new BadRequestException({
        code: 'DISCOUNT_REASON_REQUIRED',
        message: 'Discounts above 15% require an explicit justification for manager approval',
      });
    }

    // 5. Look up lead
    const lead = await this.leads.findById(id);
    if (!lead) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: `Lead with ID ${id} not found`,
      });
    }

    // 6. Validate lead status constraints
    if (lead.status === LeadStatus.LOST) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Cannot send quote to a lead that is marked as LOST',
      });
    }
    if (lead.status === LeadStatus.WON) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Cannot send quote to a lead that is already marked as WON',
      });
    }

    // 7. Determine quote approval status & final amount
    const requiresApproval = discount > 15;
    const quoteStatus = requiresApproval ? 'PENDING_APPROVAL' : 'SENT';
    const finalAmount = Math.round(dto.amount * (1 - discount / 100));

    const quoteId = randomUUID();
    const year = new Date().getFullYear();
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const quoteNumber = `QT-${year}-${randomSuffix}`;
    const validityDays = dto.validityDays ?? 30;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

    const quoteItem: LeadQuoteItem = {
      id: quoteId,
      quoteNumber,
      planName: dto.planName.trim(),
      projectScope: dto.projectScope?.trim() || undefined,
      amount: finalAmount,
      discountPercent: discount,
      discountApproved: !requiresApproval,
      discountReason: dto.discountReason?.trim() || undefined,
      status: quoteStatus,
      recipientEmail: dto.recipientEmail?.trim() || lead.contactEmail,
      expiresAt,
      sentAt: requiresApproval ? undefined : new Date(),
      pdfUrl: `/quotes/${quoteNumber.toLowerCase()}.pdf`,
      createdAt: new Date(),
    };

    // 8. Lead status transition: When sent, move to PROPOSAL if currently in early stages
    let targetLeadStatus: LeadStatus | undefined = undefined;
    if (
      quoteStatus === 'SENT' &&
      [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED].includes(lead.status)
    ) {
      targetLeadStatus = LeadStatus.PROPOSAL;
    }

    // 9. Persist quote to repository
    const updatedLead = await this.leads.addQuote(id, quoteItem, targetLeadStatus);
    if (!updatedLead) {
      throw new NotFoundException({
        code: 'LEAD_NOT_FOUND',
        message: `Failed to persist quote – lead with ID ${id} not found`,
      });
    }

    // 10. Audit log
    await this.audit.append({
      actorUserId: actor?.userId || 'system',
      organizationId: undefined,
      action: 'LEAD_QUOTE_SENT',
      resourceType: 'LEAD',
      resourceId: id,
      metadata: {
        actorEmail: actor?.email || 'system',
        quoteNumber,
        planName: quoteItem.planName,
        amount: String(dto.amount),
        finalAmount: String(finalAmount),
        discountPercent: String(discount),
        quoteStatus,
        recipientEmail: quoteItem.recipientEmail || '',
      },
    });

    this.logger.log(
      `Quote ${quoteNumber} (${quoteStatus}) created for lead ${id} by user ${actor?.email || 'system'}`,
    );

    const successMessage = requiresApproval
      ? `Quote ${quoteNumber} created and submitted for discount approval (>15%)`
      : `Quote ${quoteNumber} successfully sent to ${quoteItem.recipientEmail}`;

    return {
      quote: quoteItem,
      lead: updatedLead,
      message: successMessage,
    };
  }
}
