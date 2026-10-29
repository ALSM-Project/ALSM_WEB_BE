import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import {
  LeadDemo,
  LeadRecord,
  LeadStatus,
  ScheduleDemoInput,
  isAllowedLeadStatusTransition,
} from '../domain/lead.types';
import { SEND_QUOTE_UNIT_OF_WORK, SendQuoteUnitOfWork } from './send-quote-unit-of-work.port';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ScheduleDemoResult {
  demo: LeadDemo;
  lead: LeadRecord;
  replayed: boolean;
  message: string;
}

@Injectable()
export class ScheduleDemoService {
  private readonly logger = new Logger(ScheduleDemoService.name);

  constructor(
    @Inject(SEND_QUOTE_UNIT_OF_WORK) private readonly unitOfWork: SendQuoteUnitOfWork,
  ) {}

  async execute(
    leadId: string,
    input: ScheduleDemoInput,
    actor: AuthenticatedUser,
    requestId?: string,
  ): Promise<ScheduleDemoResult> {
    if (!leadId || !/^[a-f\d]{24}$/i.test(leadId)) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'Enter a valid lead identifier.' });
    }
    if (!actor?.userId || !/^[a-f\d]{24}$/i.test(actor.userId)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'A valid authenticated sales user is required.' });
    }
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key is required.' });
    }

    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    if (title.length < 3 || title.length > 200) {
      throw new BadRequestException({ code: 'INVALID_DEMO_TITLE', message: 'Demo title must be between 3 and 200 characters.' });
    }
    const scheduledAt = typeof input?.scheduledAt === 'string' ? new Date(input.scheduledAt) : new Date(Number.NaN);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'INVALID_DEMO_DATE', message: 'Demo date and time must be in the future.' });
    }
    const durationMinutes = input?.durationMinutes;
    if (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) {
      throw new BadRequestException({ code: 'INVALID_DEMO_DURATION', message: 'Demo duration must be between 15 and 240 minutes.' });
    }
    const inputAttendeeEmails = input?.attendeeEmails;
    if (!Array.isArray(inputAttendeeEmails) || inputAttendeeEmails.length < 1 || inputAttendeeEmails.length > 50) {
      throw new BadRequestException({ code: 'INVALID_DEMO_ATTENDEES', message: 'Add between 1 and 50 attendee email addresses.' });
    }
    const attendeeEmails = Array.from(new Set(inputAttendeeEmails.map((email) =>
      typeof email === 'string' ? email.trim().toLowerCase() : '',
    )));
    if (attendeeEmails.some((email) => !EMAIL_PATTERN.test(email))) {
      throw new BadRequestException({ code: 'INVALID_DEMO_ATTENDEE_EMAIL', message: 'Enter valid attendee email addresses.' });
    }
    if (input?.agenda !== undefined && typeof input.agenda !== 'string') {
      throw new BadRequestException({ code: 'INVALID_DEMO_AGENDA', message: 'Demo agenda must be text.' });
    }
    if (input?.internalNotes !== undefined && typeof input.internalNotes !== 'string') {
      throw new BadRequestException({ code: 'INVALID_DEMO_NOTES', message: 'Internal notes must be text.' });
    }
    const agenda = input?.agenda?.trim() || undefined;
    const internalNotes = input?.internalNotes?.trim() || undefined;
    if ((agenda?.length ?? 0) > 2000) {
      throw new BadRequestException({ code: 'INVALID_DEMO_AGENDA', message: 'Demo agenda cannot exceed 2,000 characters.' });
    }
    if ((internalNotes?.length ?? 0) > 2000) {
      throw new BadRequestException({ code: 'INVALID_DEMO_NOTES', message: 'Internal notes cannot exceed 2,000 characters.' });
    }

    const normalized = {
      title,
      scheduledAt: scheduledAt.toISOString(),
      durationMinutes,
      attendeeEmails,
      agenda,
      internalNotes,
    };
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ actorUserId: actor.userId, ...normalized }))
      .digest('hex');

    const result = await this.unitOfWork.run(async ({ leads, audit }) => {
      const lead = await leads.findById(leadId);
      if (!lead) {
        throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'This lead could not be found.' });
      }

      const previous = lead.demos?.find((demo) => demo.requestId === requestId);
      if (previous) {
        if (previous.requestFingerprint !== requestFingerprint) {
          throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request ID was already used for different demo details.' });
        }
        return {
          demo: previous,
          lead,
          replayed: true,
          message: 'This demo was already scheduled; no duplicate appointment was created.',
        };
      }

      if (lead.status === LeadStatus.WON || lead.status === LeadStatus.LOST) {
        throw new BadRequestException({
          code: 'LEAD_NOT_SCHEDULABLE',
          message: 'A demo cannot be scheduled for a closed lead.',
        });
      }

      const nextStatus = lead.status === LeadStatus.NEW || lead.status === LeadStatus.CONTACTED
        ? LeadStatus.QUALIFIED
        : lead.status;
      if (!isAllowedLeadStatusTransition(lead.status, nextStatus)) {
        throw new BadRequestException({ code: 'INVALID_STATUS_TRANSITION', message: 'The lead status does not allow a demo to be scheduled.' });
      }

      const now = new Date();
      const demo: LeadDemo = {
        id: randomUUID(),
        requestId,
        requestFingerprint,
        ...normalized,
        scheduledAt,
        status: 'SCHEDULED',
        scheduledByUserId: actor.userId,
        scheduledByEmail: actor.email,
        createdAt: now,
      };
      const updatedLead = await leads.addDemoOnce(leadId, demo, lead.status, nextStatus);
      if (!updatedLead) {
        const latest = await leads.findById(leadId);
        if (!latest) {
          throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'This lead could not be found.' });
        }
        const committed = latest.demos?.find((item) => item.requestId === requestId);
        if (committed) {
          if (committed.requestFingerprint !== requestFingerprint) {
            throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This request ID was already used for different demo details.' });
          }
          return {
            demo: committed,
            lead: latest,
            replayed: true,
            message: 'This demo was already scheduled; no duplicate appointment was created.',
          };
        }
        throw new ConflictException({
          code: 'LEAD_STATE_CHANGED',
          message: 'The lead changed while the demo was being scheduled. Refresh and try again.',
        });
      }

      await audit.append({
        actorUserId: actor.userId,
        action: 'LEAD_DEMO_SCHEDULED',
        resourceType: 'LEAD',
        resourceId: leadId,
        metadata: {
          demoId: demo.id,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: String(demo.durationMinutes),
          attendeeCount: String(attendeeEmails.length),
          status: demo.status,
        },
      });
      return {
        demo,
        lead: updatedLead,
        replayed: false,
        message: 'Demo scheduled successfully.',
      };
    }, leadId);

    if (!result.replayed) {
      this.logger.log(`Demo ${result.demo.id} scheduled for lead ${leadId}.`);
    }
    return result;
  }
}
