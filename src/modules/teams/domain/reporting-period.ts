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
