import { BadRequestException } from '@nestjs/common';
import { ReviewDiscountService } from '../src/modules/crm/application/review-discount.service';
import { SalesUnitOfWork } from '../src/modules/crm/application/sales-unit-of-work.port';

describe('ReviewDiscountService (UC-70)', () => {
  const actorUserId = '6a8d90b0569ea93e27ad862c';
  const organizationId = '6a9cdbda5e82fb42d449ac03';
  const leadId = '6ad586fe9f2215c9ebcac858';
  const quoteId = 'quote-request-01';
  let reviewDiscount: jest.Mock;
  let append: jest.Mock;
  let run: jest.Mock;
  let service: ReviewDiscountService;

  beforeEach(() => {
    reviewDiscount = jest.fn().mockResolvedValue({
      organizationId: '6a9cdbda5e82fb42d449ac03',
      company: 'Zenith Holdings',
      quote: { id: quoteId, discountPercent: 15 },
      replayed: false,
    });
    append = jest.fn().mockResolvedValue(undefined);
    run = jest.fn(async (work: (repositories: any) => Promise<unknown>) =>
      work({ leads: { reviewDiscount }, audit: { append }, revenue: {} }),
    );
    service = new ReviewDiscountService({ run } as unknown as SalesUnitOfWork);
  });

  it('persists the approved decision and audit event in the unit of work', async () => {
    const result = await service.execute({ actorUserId, organizationId, leadId, quoteId, outcome: 'APPROVE' });

    expect(reviewDiscount).toHaveBeenCalledWith({ leadId, organizationId, quoteId, actorUserId, outcome: 'APPROVE', reason: undefined });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId,
      organizationId: '6a9cdbda5e82fb42d449ac03',
      action: 'DISCOUNT_APPROVED',
      resourceType: 'QUOTE',
      resourceId: quoteId,
    }));
    expect(result).toMatchObject({ success: true, outcome: 'APPROVE', replayed: false });
  });

  it('rejects an empty or too-short rationale before opening a transaction', async () => {
    await expect(service.execute({ actorUserId, organizationId, leadId, quoteId, outcome: 'REJECT', reason: 'no' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not append a duplicate audit event when a request is replayed', async () => {
    reviewDiscount.mockResolvedValueOnce({
      organizationId: '6a9cdbda5e82fb42d449ac03', company: 'Zenith Holdings',
      quote: { id: quoteId }, replayed: true,
    });

    const result = await service.execute({ actorUserId, organizationId, leadId, quoteId, outcome: 'APPROVE' });

    expect(result.replayed).toBe(true);
    expect(append).not.toHaveBeenCalled();
  });

  it('propagates audit failure so the transaction can roll back the quote state', async () => {
    append.mockRejectedValueOnce(new Error('audit storage unavailable'));

    await expect(service.execute({ actorUserId, organizationId, leadId, quoteId, outcome: 'APPROVE' }))
      .rejects.toThrow('audit storage unavailable');
  });
});
