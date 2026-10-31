import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { LeadContractRecord } from '../domain/lead.types';
import { SALES_UNIT_OF_WORK, SalesUnitOfWork } from './sales-unit-of-work.port';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export type PublicLeadContract = Omit<LeadContractRecord, 'requestId' | 'requestFingerprint' | 'createdByUserId'>;

export interface CreateContractResult {
  contract: PublicLeadContract;
  replayed: boolean;
  message: string;
}

export interface CreateContractInput {
  title: string;
  plan: string;
  quoteId?: string;
  annualValue: number;
  effectiveDate?: string;
}

@Injectable()
export class CreateContractService {
  private readonly logger = new Logger(CreateContractService.name);

  constructor(@Inject(SALES_UNIT_OF_WORK) private readonly unitOfWork: SalesUnitOfWork) {}

  async execute(
    leadId: string,
    input: CreateContractInput,
    actor: AuthenticatedUser,
    requestId?: string,
  ): Promise<CreateContractResult> {
    if (!OBJECT_ID_PATTERN.test(leadId || '')) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'Enter a valid lead identifier.' });
    }
    if (!actor?.userId || !OBJECT_ID_PATTERN.test(actor.userId)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'A valid authenticated sales user is required.' });
    }
    if (!requestId || !UUID_PATTERN.test(requestId)) {
      throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'A valid Idempotency-Key is required.' });
    }

    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    const plan = typeof input?.plan === 'string' ? input.plan.trim() : '';
    const quoteId = typeof input?.quoteId === 'string' ? input.quoteId.trim() || undefined : undefined;
    const annualValue = input?.annualValue;
    if (title.length < 3 || title.length > 200) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_TITLE', message: 'Contract title must be between 3 and 200 characters.' });
    }
    if (plan.length < 2 || plan.length > 100) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_PLAN', message: 'Select a valid contract plan.' });
    }
    if (!Number.isSafeInteger(annualValue) || annualValue < 1) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_VALUE', message: 'Contract value must be a positive whole VND amount.' });
    }
    if (quoteId && quoteId.length > 100) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_QUOTE', message: 'The quote identifier is invalid.' });
    }

    const effectiveDate = input?.effectiveDate || new Date().toISOString().slice(0, 10);
    const date = new Date(`${effectiveDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== effectiveDate) {
      throw new BadRequestException({ code: 'INVALID_CONTRACT_EFFECTIVE_DATE', message: 'Enter a valid effective date.' });
    }

    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ actorUserId: actor.userId, title, plan, quoteId, annualValue, effectiveDate }))
      .digest('hex');
    const contract: Omit<LeadContractRecord, 'requestId' | 'requestFingerprint' | 'contractNumber'> = {
      id: randomUUID(),
      title,
      plan,
      quoteId,
      annualValue,
      status: 'DRAFT',
      effectiveDate,
      createdByUserId: actor.userId,
      createdAt: new Date(),
    };

    const result = await this.unitOfWork.run(async ({ leads, audit }) => {
      const created = await leads.addContract({
        leadId,
        requestId,
        requestFingerprint,
        contract,
      });
      if (!created) {
        throw new NotFoundException({ code: 'LEAD_NOT_FOUND', message: 'This lead could not be found.' });
      }

      if (!created.replayed) {
        await audit.append({
          actorUserId: actor.userId,
          organizationId: created.lead.organizationId,
          action: 'LEAD_CONTRACT_CREATED',
          resourceType: 'LEAD',
          resourceId: leadId,
          metadata: {
            contractId: created.contract.id,
            contractNumber: created.contract.contractNumber,
            title: created.contract.title,
            plan: created.contract.plan,
            quoteId: created.contract.quoteId ?? '',
            annualValue: String(created.contract.annualValue),
            status: created.contract.status,
          },
        });
      }
      return created;
    }, leadId);

    if (!result.replayed) {
      this.logger.log(`Contract ${result.contract.contractNumber} created for lead ${leadId}.`);
    }

    const { requestId: _requestId, requestFingerprint: _requestFingerprint, createdByUserId: _createdByUserId, ...publicContract } = result.contract;
    void _requestId;
    void _requestFingerprint;
    void _createdByUserId;
    return {
      contract: publicContract,
      replayed: result.replayed,
      message: result.replayed
        ? 'This contract was already created; no duplicate contract was added.'
        : 'Contract draft created successfully.',
    };
  }
}
