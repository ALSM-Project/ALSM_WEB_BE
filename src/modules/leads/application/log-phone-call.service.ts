import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { LeadPhoneCall, LeadPhoneCallOutcome, LeadRecord, LeadStatus, LogPhoneCallInput } from '../domain/lead.types';
import { SEND_QUOTE_UNIT_OF_WORK, SendQuoteUnitOfWork } from './send-quote-unit-of-work.port';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LogPhoneCallResult {
  call: LeadPhoneCall;
  lead: LeadRecord;
  replayed: boolean;
  message: string;
}

@Injectable()
export class LogPhoneCallService {
  private readonly logger = new Logger(LogPhoneCallService.name);

  constructor(
    @Inject(SEND_QUOTE_UNIT_OF_WORK) private readonly unitOfWork: SendQuoteUnitOfWork,
  ) {}

  async execute(
    id: string,
    dto: LogPhoneCallInput,
    actor: AuthenticatedUser,
    requestId?: string,
  ): Promise<LogPhoneCallResult> {
    if (!id || !/^[a-f\d]{24}$/i.test(id)) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'Enter a valid lead identifier.' });
    }
    if (!actor?.userId || !/^[a-f\d]{24}$/i.test(actor.userId)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'A valid authenticated sales user is required.' });
    }
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException({ code: 'INVALID_CALL_DETAILS', message: 'Enter valid phone call details.' });
    }
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key is required.' });
    }
    const summary = typeof dto.summary === 'string' ? dto.summary.trim() : '';
    if (summary.length < 1 || summary.length > 500) {
      throw new BadRequestException({ code: 'INVALID_CALL_SUMMARY', message: 'Enter a call summary up to 500 characters.' });
    }
    if (!Number.isInteger(dto.durationMinutes) || dto.durationMinutes < 1 || dto.durationMinutes > 480) {
      throw new BadRequestException({ code: 'INVALID_CALL_DURATION', message: 'Call duration must be between 1 and 480 minutes.' });
    }
    if (!Object.values(LeadPhoneCallOutcome).includes(dto.outcome)) {
      throw new BadRequestException({ code: 'INVALID_CALL_OUTCOME', message: 'Select a valid call outcome.' });
    }

    const followUpAt = dto.followUpAt ? new Date(dto.followUpAt) : undefined;
    if (followUpAt && (!Number.isFinite(followUpAt.getTime()) || followUpAt.getTime() <= Date.now())) {
      throw new BadRequestException({ code: 'INVALID_FOLLOW_UP_DATE', message: 'Follow-up time must be in the future.' });
    }

    const normalized = {
      outcome: dto.outcome,
      durationMinutes: dto.durationMinutes,
      summary,
      notes: dto.notes?.trim() || undefined,
      followUpAt: followUpAt?.toISOString(),
    };
    if (normalized.notes && normalized.notes.length > 2000) {
      throw new BadRequestException({ code: 'INVALID_CALL_NOTES', message: 'Call notes cannot exceed 2,000 characters.' });
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ actorUserId: actor.userId, ...normalized }))
      .digest('hex');

    try {
      const result = await this.unitOfWork.run(async ({ leads, audit }) => {
        const existing = await leads.findById(id);
        if (!existing) {
          throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'This lead could not be found.' });
        }

        const previous = existing.phoneCalls?.find((call) => call.requestId === requestId);
        if (previous) {
          if (previous.requestFingerprint !== fingerprint) {
            throw new ConflictException({
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'This request ID was already used for a different call log.',
            });
          }
          return {
            call: previous,
            lead: existing,
            replayed: true,
            message: 'This call was already logged; no duplicate activity was created.',
          };
        }

        const now = new Date();
        const call: LeadPhoneCall = {
          id: randomUUID(),
          requestId,
          requestFingerprint: fingerprint,
          ...normalized,
          followUpAt,
          performedByUserId: actor.userId,
          performedByEmail: actor.email,
          createdAt: now,
        };
        const newStatus = existing.status === LeadStatus.NEW ? LeadStatus.CONTACTED : existing.status;
        const updatedLead = await leads.addPhoneCallOnce(id, call, existing.status, newStatus);
        if (!updatedLead) {
          const latest = await leads.findById(id);
          if (!latest) {
            throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'This lead could not be found.' });
          }
          const committed = latest.phoneCalls?.find((item) => item.requestId === requestId);
          if (committed) {
            if (committed.requestFingerprint !== fingerprint) {
              throw new ConflictException({
                code: 'IDEMPOTENCY_KEY_REUSED',
                message: 'This request ID was already used for a different call log.',
              });
            }
            return {
              call: committed,
              lead: latest,
              replayed: true,
              message: 'This call was already logged; no duplicate activity was created.',
            };
          }
          throw new ConflictException({
            code: 'LEAD_STATE_CHANGED',
            message: 'The lead changed while the call was being logged. Refresh and try again.',
          });
        }

        await audit.append({
          actorUserId: actor.userId,
          action: 'LEAD_PHONE_CALL_LOGGED',
          resourceType: 'LEAD',
          resourceId: id,
          metadata: {
            callId: call.id,
            outcome: call.outcome,
            durationMinutes: String(call.durationMinutes),
            followUpScheduled: String(Boolean(call.followUpAt)),
          },
        });
        return {
          call,
          lead: updatedLead,
          replayed: false,
          message: 'Phone call logged successfully.',
        };
      }, id);

      if (!result.replayed) this.logger.log(`Phone call activity ${result.call.id} logged for lead ${id}.`);
      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException({
          code: 'PHONE_CALL_LOG_UNAVAILABLE',
          message: 'Call logging is temporarily unavailable. Retry the same submission shortly.',
        });
      }
      throw error;
    }
  }
}
