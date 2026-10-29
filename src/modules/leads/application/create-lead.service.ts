import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { LeadPriority, LeadRecord, LeadSource } from '../domain/lead.types';
import { CreateLeadDto } from '../presentation/lead.dto';
import {
  SEND_QUOTE_UNIT_OF_WORK,
  SendQuoteUnitOfWork,
} from './send-quote-unit-of-work.port';

export interface CreateLeadResult {
  lead: LeadRecord;
  replayed: boolean;
  message: string;
}

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CreateLeadService {
  private readonly logger = new Logger(CreateLeadService.name);

  constructor(
    @Inject(SEND_QUOTE_UNIT_OF_WORK) private readonly unitOfWork: SendQuoteUnitOfWork,
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
      currency: dto.currency?.trim().toUpperCase() || 'USD',
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
    return {
      lead: outcome.lead,
      replayed: outcome.replayed,
      message: outcome.replayed ? 'This lead was already created.' : 'Lead created successfully.',
    };
  }
}
