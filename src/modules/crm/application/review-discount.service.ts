import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { SALES_UNIT_OF_WORK, SalesUnitOfWork } from './sales-unit-of-work.port';
import { DiscountReviewOutcome } from '../domain/lead.types';

@Injectable()
export class ReviewDiscountService {
  constructor(@Inject(SALES_UNIT_OF_WORK) private readonly unitOfWork: SalesUnitOfWork) {}

  async execute(input: {
    actorUserId: string;
    organizationId: string;
    leadId: string;
    quoteId: string;
    outcome: DiscountReviewOutcome;
    reason?: string;
  }) {
    if (!Types.ObjectId.isValid(input.actorUserId)) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'An authenticated sales manager is required.' });
    }
    if (!/^[a-f\d]{24}$/i.test(input.leadId || '')) {
      throw new BadRequestException({ code: 'INVALID_LEAD_ID', message: 'The lead identifier is invalid.' });
    }
    if (!/^[a-f\d]{24}$/i.test(input.organizationId || '')) {
      throw new BadRequestException({ code: 'INVALID_ORGANIZATION_ID', message: 'The organization identifier is invalid.' });
    }
    const quoteId = typeof input.quoteId === 'string' ? input.quoteId.trim() : '';
    if (!quoteId || quoteId.length > 100) {
      throw new BadRequestException({ code: 'INVALID_QUOTE_ID', message: 'The quote identifier is invalid.' });
    }
    const reason = typeof input.reason === 'string' ? input.reason.trim() : undefined;
    if (input.outcome === 'REJECT' && (!reason || reason.length < 5 || reason.length > 500)) {
      throw new BadRequestException({ code: 'INVALID_REJECTION_REASON', message: 'Provide a rejection reason between 5 and 500 characters.' });
    }

    return this.unitOfWork.run(async ({ leads, audit }) => {
      const result = await leads.reviewDiscount({
        leadId: input.leadId,
        organizationId: input.organizationId,
        quoteId,
        actorUserId: input.actorUserId,
        outcome: input.outcome,
        reason,
      });
      if (!result.replayed) {
        await audit.append({
          actorUserId: input.actorUserId,
          organizationId: result.organizationId,
          action: input.outcome === 'APPROVE'
            ? 'DISCOUNT_APPROVED'
            : input.outcome === 'REJECT'
              ? 'DISCOUNT_REJECTED'
              : 'DISCOUNT_ESCALATED',
          resourceType: 'QUOTE',
          resourceId: quoteId,
          metadata: {
            leadId: input.leadId,
            discountPercent: String(result.quote.discountPercent ?? 0),
            ...(reason ? { reason } : {}),
          },
        });
      }
      return {
        success: true,
        outcome: input.outcome,
        replayed: result.replayed,
        quote: result.quote,
        message: result.replayed
          ? 'This discount request was already processed; no duplicate change was made.'
          : input.outcome === 'APPROVE'
            ? 'Discount approved and quote sent.'
            : input.outcome === 'REJECT'
              ? 'Discount rejected.'
              : 'Discount escalated for higher approval.',
      };
    }, `${input.organizationId}:${input.leadId}:${quoteId}`);
  }
}
