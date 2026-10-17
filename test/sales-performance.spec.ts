import {
  summarizeSales,
  SalesSourceRecords,
} from '../src/modules/crm/domain/sales-performance-source.port';
describe('approved assignment-start sales cohort and actual confirmed VND revenue', () => {
  it('credits conversion to the event assignee, deduplicates reassignments and computes unique team totals', () => {
    const records: SalesSourceRecords = {
      leads: [
        { leadId: 'l1', memberIds: ['a', 'b', 'a'], convertedMemberId: 'b' },
        { leadId: 'l2', memberIds: ['a'] },
        { leadId: 'l3', memberIds: ['b'], convertedMemberId: 'b' },
      ],
      revenue: [
        { paymentId: 'p1', memberId: 'b', amountVnd: 1500 },
        { paymentId: 'p1', memberId: 'b', amountVnd: 1500 },
        { paymentId: 'p2', memberId: 'a', amountVnd: 500 },
      ],
    };
    const result = summarizeSales(records, ['a', 'b']);
    expect(result.members[0].metrics).toMatchObject({
      leadCount: { value: 2 },
      conversionRate: { value: 0 },
      revenueGenerated: { value: 500 },
    });
    expect(result.members[1].metrics).toMatchObject({
      leadCount: { value: 2 },
      conversionRate: { value: 100 },
      revenueGenerated: { value: 1500 },
    });
    expect(result.metrics.leadCount).toMatchObject({ value: 3 });
    expect(result.metrics.conversionRate).toMatchObject({ value: (2 / 3) * 100 });
    expect(result.metrics.revenueGenerated).toMatchObject({ value: 2000, unit: 'VND' });
  });
  it('handles zero assigned leads explicitly without inventing a conversion percentage', () => {
    const result = summarizeSales({ leads: [], revenue: [] }, ['a']);
    expect(result.metrics).toEqual({
      leadCount: { available: true, value: 0, unit: 'COUNT' },
      conversionRate: { available: false, code: 'NO_ASSIGNED_LEADS', reason: expect.any(String) },
      revenueGenerated: { available: true, value: 0, unit: 'VND' },
    });
  });
  it('excludes inaccessible contributors and conversions outside the credited assigned cohort', () => {
    const result = summarizeSales(
      {
        leads: [
          { leadId: 'l1', memberIds: ['a'], convertedMemberId: 'b' },
          { leadId: 'l2', memberIds: ['foreign'], convertedMemberId: 'foreign' },
        ],
        revenue: [{ paymentId: 'p', memberId: 'foreign', amountVnd: 999 }],
      },
      ['a', 'b'],
    );
    expect(result.metrics.leadCount).toMatchObject({ value: 1 });
    expect(result.metrics.conversionRate).toMatchObject({ value: 0 });
    expect(result.metrics.revenueGenerated).toMatchObject({ value: 0 });
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid or inexact confirmed source amounts %s',
    (amountVnd) => {
      expect(() =>
        summarizeSales({ leads: [], revenue: [{ paymentId: 'p', memberId: 'a', amountVnd }] }, [
          'a',
        ]),
      ).toThrow('Invalid confirmed');
    },
  );
});
