import {
  reportingPeriod,
  unavailableSalesMetrics,
} from '../src/modules/teams/domain/reporting-period';

describe('approved reporting periods and unavailable sales sources', () => {
  it.each([7, 30])(
    'uses exactly %i elapsed days with an exclusive end independent of host timezone',
    (days) => {
      const asOf = new Date('2026-10-17T00:00:00.000+07:00');
      const period = reportingPeriod(days, asOf);
      expect(new Date(period.end).getTime() - new Date(period.start).getTime()).toBe(
        days * 86400000,
      );
      expect(period.end).toBe('2026-10-16T17:00:00.000Z');
      expect(period.boundaries).toBe('[start,end)');
    },
  );
  it.each([0, 8, 31, NaN, 7.5])('rejects unsupported period %s', (days) => {
    expect(() => reportingPeriod(days, new Date())).toThrow(RangeError);
  });
  it('keeps missing leads, outcomes and confirmed revenue unavailable instead of zero', () => {
    const metrics = unavailableSalesMetrics();
    for (const metric of Object.values(metrics)) {
      expect(metric.available).toBe(false);
      expect(metric).not.toHaveProperty('value');
    }
    expect(metrics.conversionRate.reason).toContain('converted leads / assigned leads * 100');
  });
});
