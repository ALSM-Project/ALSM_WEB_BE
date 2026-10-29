import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { LeadQuoteItem, LeadRecord, LeadStatus } from '../domain/lead.types';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { SendQuoteDto } from '../presentation/lead.dto';
import {
  SEND_QUOTE_UNIT_OF_WORK,
  SendQuoteUnitOfWork,
} from './send-quote-unit-of-work.port';

export interface SendQuoteResult {
  quote: LeadQuoteItem;
  lead: LeadRecord;
  message: string;
}

@Injectable()
export class SendQuoteService {
  private readonly logger = new Logger(SendQuoteService.name);

  constructor(
    @Inject(SEND_QUOTE_UNIT_OF_WORK) private readonly unitOfWork: SendQuoteUnitOfWork,
  ) {}

  async execute(id: string, dto: SendQuoteDto, actor?: AuthenticatedUser): Promise<SendQuoteResult> {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'Lead ID is invalid' });
    }
    if (!dto.planName?.trim()) {
      throw new BadRequestException({ code: 'INVALID_PLAN_NAME', message: 'Plan name cannot be empty' });
    }
    if (!Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Quote amount must be greater than 0' });
    }
    const discount = dto.discountPercent ?? 0;
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      throw new BadRequestException({ code: 'INVALID_DISCOUNT', message: 'Discount must be between 0 and 100 percent' });
    }
    if (discount > 15 && !dto.discountReason?.trim()) {
      throw new BadRequestException({ code: 'DISCOUNT_REASON_REQUIRED', message: 'Discounts above 15% require a justification' });
    }
    const validityDays = dto.validityDays ?? 30;
    if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365) {
      throw new BadRequestException({ code: 'INVALID_VALIDITY_DAYS', message: 'Validity must be between 1 and 365 days' });
    }
    if (!dto.requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.requestId)) {
      throw new BadRequestException({ code: 'INVALID_REQUEST_ID', message: 'A valid request ID is required to submit a quote' });
    }
    if (dto.recipientEmail && !/^\S+@\S+\.\S+$/.test(dto.recipientEmail.trim())) {
      throw new BadRequestException({ code: 'INVALID_RECIPIENT_EMAIL', message: 'Recipient email address is invalid' });
    }

    const normalized = {
      planName: dto.planName.trim(),
      projectScope: dto.projectScope?.trim() || undefined,
      amount: dto.amount,
      discountPercent: discount,
      discountReason: dto.discountReason?.trim() || undefined,
      recipientEmail: dto.recipientEmail?.trim().toLowerCase() || undefined,
      validityDays,
      notes: dto.notes?.trim() || undefined,
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');

    return this.unitOfWork.run(async ({ leads, audit }) => {
      const lead = await leads.findById(id);
      if (!lead) {
        throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead was not found' });
      }

      const replay = lead.quotes?.find((item) => item.requestId === dto.requestId);
      if (replay) {
        if (replay.requestFingerprint !== fingerprint) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request ID was already used for a different quote' });
        }
        return { quote: replay, lead, message: `Quote ${replay.quoteNumber} was already processed` };
      }

      if (lead.status === LeadStatus.LOST || lead.status === LeadStatus.WON) {
        throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot send a quote to a ${lead.status.toLowerCase()} lead` });
      }

      const requiresApproval = discount > 15;
      const quoteStatus: LeadQuoteItem['status'] = requiresApproval ? 'PENDING_APPROVAL' : 'SENT';
      const finalAmount = Math.round(dto.amount * (1 - discount / 100));
      const quoteNumber = `QT-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
      const quote: LeadQuoteItem = {
        id: randomUUID(),
        requestId: dto.requestId,
        requestFingerprint: fingerprint,
        quoteNumber,
        planName: normalized.planName,
        projectScope: normalized.projectScope,
        amount: finalAmount,
        discountPercent: discount,
        discountApproved: !requiresApproval,
        discountReason: normalized.discountReason,
        status: quoteStatus,
        recipientEmail: normalized.recipientEmail || lead.contactEmail,
        expiresAt: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000),
        sentAt: requiresApproval ? undefined : new Date(),
        pdfUrl: `/quotes/${quoteNumber.toLowerCase()}.pdf`,
        createdAt: new Date(),
      };

      const targetStatus = quoteStatus === 'SENT' &&
        [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED].includes(lead.status)
        ? LeadStatus.PROPOSAL
        : undefined;
      let updatedLead = await leads.addQuoteOnce(id, quote, lead.status, targetStatus);
      if (!updatedLead) {
        // A concurrent retry may have committed this request while this transaction was starting.
        const latest = await leads.findById(id);
        const committed = latest?.quotes?.find((item) => item.requestId === dto.requestId);
        if (latest && committed?.requestFingerprint === fingerprint) {
          return { quote: committed, lead: latest, message: `Quote ${committed.quoteNumber} was already processed` };
        }
        if (latest && committed) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request ID was already used for a different quote' });
        }
        throw new ConflictException({ code: 'LEAD_STATE_CHANGED', message: 'The lead changed while the quote was being processed. Refresh and try again.' });
      }

      await audit.append({
        actorUserId: actor?.userId,
        action: 'LEAD_QUOTE_SENT',
        resourceType: 'LEAD',
        resourceId: id,
        metadata: {
          quoteNumber,
          planName: quote.planName,
          finalAmount: String(finalAmount),
          discountPercent: String(discount),
          quoteStatus,
        },
      });

      this.logger.log(`Quote ${quoteNumber} (${quoteStatus}) created for lead ${id}`);
      return {
        quote,
        lead: updatedLead,
        message: requiresApproval
          ? `Quote ${quoteNumber} was submitted for discount approval`
          : `Quote ${quoteNumber} was sent successfully`,
      };
    }, id);
  }
}
