import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import {
  LEAD_REPOSITORY,
  LeadPriority,
  LeadRecord,
  LeadRepository,
  LeadSource,
} from '../domain/lead.types';
import { CreateLeadDto } from '../presentation/lead.dto';
import { MailService } from '../../../shared/mail/mail.service';
import {
  SEND_QUOTE_UNIT_OF_WORK,
  SendQuoteUnitOfWork,
} from './send-quote-unit-of-work.port';

export interface CreateLeadResult {
  lead: LeadRecord;
  replayed: boolean;
  notificationSent: boolean | null;
  message: string;
}

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CreateLeadService {
  private readonly logger = new Logger(CreateLeadService.name);

  constructor(
    @Inject(SEND_QUOTE_UNIT_OF_WORK) private readonly unitOfWork: SendQuoteUnitOfWork,
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepository,
    private readonly mail: MailService,
  ) {}

  async execute(
    dto: CreateLeadDto,
    actor: AuthenticatedUser,
    requestId?: string,
  ): Promise<CreateLeadResult> {
    if (!actor?.userId || !/^[a-f\d]{24}$/i.test(actor.userId)) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'A valid authenticated sales user is required',
      });
    }
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'A valid Idempotency-Key is required to create a lead',
      });
    }

    const normalized = {
      companyName: dto.companyName.trim(),
      contactName: dto.contactName.trim(),
      contactEmail: dto.contactEmail.trim().toLowerCase(),
      contactPhone: dto.contactPhone?.trim() || undefined,
      jobTitle: dto.jobTitle?.trim() || undefined,
      source: dto.source ?? LeadSource.WEBSITE,
      priority: dto.priority ?? LeadPriority.MEDIUM,
      estimatedValue: dto.estimatedValue,
      currency: 'VND' as const,
      notes: dto.notes?.trim() || undefined,
    };

    if (!normalized.companyName || !normalized.contactName || !/^\S+@\S+\.\S+$/.test(normalized.contactEmail)) {
      throw new BadRequestException({
        code: 'INVALID_LEAD_DETAILS',
        message: 'Enter a company, contact name, and valid contact email',
      });
    }

    const leadId = createHash('sha256')
      .update(`${actor.userId}:${requestId.toLowerCase()}`)
      .digest('hex')
      .slice(0, 24);
    const creationFingerprint = createHash('sha256')
      .update(JSON.stringify({ actorId: actor.userId, ...normalized }))
      .digest('hex');
    const dedupeKey = createHash('sha256')
      .update(normalized.contactEmail)
      .digest('hex');

    let outcome: { lead: LeadRecord; replayed: boolean };
    try {
      outcome = await this.unitOfWork.run(async ({ leads, audit }) => {
        const created = await leads.create({
          id: leadId,
          creationFingerprint,
          dedupeKey,
          ...normalized,
          assignedToUserId: actor.userId,
          assignedToEmail: actor.email,
          tags: [],
          createdByUserId: actor.userId,
          createdByEmail: actor.email,
        });

        if (!created.replayed) {
          await audit.append({
            actorUserId: actor.userId,
            action: 'LEAD_CREATED',
            resourceType: 'LEAD',
            resourceId: created.lead.id,
            metadata: {
              source: normalized.source,
              priority: normalized.priority,
            },
          });
        }
        return created;
      }, leadId);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException({
          code: 'LEAD_CREATION_UNAVAILABLE',
          message: 'Lead creation is temporarily unavailable. Retry the same request shortly.',
        });
      }
      throw error;
    }

    if (!outcome.replayed) this.logger.log(`Lead ${leadId} created by authenticated sales user`);
    let notificationLead = outcome.lead;
    try {
      notificationLead = await this.deliverContactNotification(leadId, requestId) ?? outcome.lead;
    } catch {
      this.logger.warn(`Lead contact notification status could not be confirmed for lead ${leadId}.`);
    }
    const notificationSent = this.notificationSent(notificationLead);
    return {
      lead: notificationLead,
      replayed: outcome.replayed,
      notificationSent,
      message: this.notificationMessage(notificationLead, outcome.replayed),
    };
  }

  async notifyContact(id: string, requestId?: string): Promise<CreateLeadResult> {
    if (!/^[a-f\d]{24}$/i.test(id)) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'Enter a valid lead identifier.' });
    }
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new BadRequestException({
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'A valid Idempotency-Key is required to send the notification.',
      });
    }
    const existing = await this.leads.findById(id);
    if (!existing) {
      throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'Lead was not found.' });
    }
    const lead = await this.deliverContactNotification(id, requestId) ?? existing;
    const notificationSent = this.notificationSent(lead);
    return {
      lead,
      replayed: notificationSent === true,
      notificationSent,
      message: this.notificationMessage(lead, notificationSent === true),
    };
  }

  private async deliverContactNotification(id: string, requestId: string): Promise<LeadRecord | null> {
    const claimed = await this.leads.claimEmailNotification(id, requestId);
    if (!claimed) return this.leads.findById(id);

    let delivered = false;
    try {
      delivered = await this.mail.sendLeadCreatedNotification({
        to: claimed.contactEmail,
        contactName: claimed.contactName,
        companyName: claimed.companyName,
      });
    } catch {
      delivered = false;
    }

    if (!delivered) this.logger.warn(`Lead contact notification was not sent for lead ${id}.`);
    try {
      const completed = await this.leads.completeEmailNotification(id, requestId, delivered);
      if (delivered && completed?.emailNotificationStatus === 'SENT') {
        this.logger.log(`Lead contact notification sent for lead ${id}.`);
      }
      return completed ?? claimed;
    } catch {
      this.logger.warn(`Lead contact notification status could not be saved for lead ${id}.`);
      return claimed;
    }
  }

  private notificationSent(lead: LeadRecord): boolean | null {
    if (lead.emailNotificationStatus === 'SENT') return true;
    if (lead.emailNotificationStatus === 'FAILED') return false;
    return null;
  }

  private notificationMessage(lead: LeadRecord, replayed: boolean): string {
    if (lead.emailNotificationStatus === 'SENT') {
      return replayed
        ? 'The contact notification email was already sent; no duplicate email was sent.'
        : 'The contact notification email was sent.';
    }
    if (lead.emailNotificationStatus === 'FAILED') {
      return 'The lead is saved, but the contact email could not be sent. Retry the email or contact them manually.';
    }
    return 'The lead is saved. Email delivery is still being processed; check the notification status shortly.';
  }
}
