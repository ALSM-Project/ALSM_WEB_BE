export function reportingPeriod(days: number, asOf: Date) {
  if (days !== 7 && days !== 30) throw new RangeError('Reporting period must be 7 or 30 days');
  return {
    days,
    start: new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
    end: asOf.toISOString(),
    basis: 'ROLLING_UTC' as const,
    boundaries: '[start,end)' as const,
  };
}

export interface UnavailableSalesMetric {
  available: false;
  reason: string;
}

export function unavailableSalesMetrics(): Record<
  'leadCount' | 'conversionRate' | 'revenueGenerated',
  UnavailableSalesMetric
> {
  return {
    leadCount: {
      available: false,
      reason: 'Persisted salesperson lead assignments are not available.',
    },
    conversionRate: {
      available: false,
      reason:
        'Assigned leads and a verified converted-to-customer status are not available. The approved formula is converted leads / assigned leads * 100.',
    },
    revenueGenerated: {
      available: false,
      reason: 'Confirmed revenue with reliable salesperson attribution is not available.',
    },
  };
}
