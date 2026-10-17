import { SalesRevenueRow } from '../../billing/domain/sales-revenue.port';
export interface SalesLeadCohort {
  leadId: string;
  memberIds: string[];
  convertedMemberId?: string;
}
export interface SalesSourceRecords {
  leads: SalesLeadCohort[];
  revenue: SalesRevenueRow[];
}
export interface SalesPerformanceSource {
  read(organizationId: string, teamId: string, start: Date, end: Date): Promise<SalesSourceRecords>;
}
export const SALES_PERFORMANCE_SOURCE = Symbol('SALES_PERFORMANCE_SOURCE');

export type SalesMetric =
  | { available: true; value: number; unit: 'COUNT' | 'PERCENT' | 'VND' }
  | { available: false; reason: string; code: 'NO_ASSIGNED_LEADS' };
export interface SalesMetrics {
  leadCount: SalesMetric;
  conversionRate: SalesMetric;
  revenueGenerated: SalesMetric;
}
export function summarizeSales(records: SalesSourceRecords, allowedMembers: string[]) {
  const allowed = new Set(allowedMembers);
  const calculate = (memberId?: string): SalesMetrics => {
    const eligible = records.leads.filter((lead) =>
      lead.memberIds.some((id) => allowed.has(id) && (!memberId || id === memberId)),
    );
    const leads = new Set(eligible.map((lead) => lead.leadId));
    const converted = new Set(
      eligible
        .filter(
          (lead) =>
            lead.convertedMemberId &&
            lead.memberIds.includes(lead.convertedMemberId) &&
            allowed.has(lead.convertedMemberId) &&
            (!memberId || lead.convertedMemberId === memberId),
        )
        .map((lead) => lead.leadId),
    );
    const relevant = records.revenue.filter(
      (row) => allowed.has(row.memberId) && (!memberId || row.memberId === memberId),
    );
    if (relevant.some((row) => !Number.isSafeInteger(row.amountVnd) || row.amountVnd < 0))
      throw new Error('Invalid confirmed VND source amount');
    const payments = new Map(relevant.map((row) => [row.paymentId, row.amountVnd]));
    const revenue = [...payments.values()].reduce((sum, amount) => sum + amount, 0);
    if (!Number.isSafeInteger(revenue) || revenue < 0)
      throw new Error('Confirmed revenue exceeds the supported exact integer range');
    return {
      leadCount: { available: true, value: leads.size, unit: 'COUNT' },
      conversionRate: leads.size
        ? { available: true, value: (converted.size / leads.size) * 100, unit: 'PERCENT' }
        : {
            available: false,
            reason: 'No leads were assigned during this reporting period.',
            code: 'NO_ASSIGNED_LEADS',
          },
      revenueGenerated: { available: true, value: revenue, unit: 'VND' },
    };
  };
  return {
    metrics: calculate(),
    members: allowedMembers.map((userId) => ({ userId, metrics: calculate(userId) })),
  };
}
