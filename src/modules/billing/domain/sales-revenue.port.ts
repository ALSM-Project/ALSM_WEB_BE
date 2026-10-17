export interface SalesPaymentResponsibility {
  paymentId: string;
  organizationId: string;
  teamId: string;
  salespersonId: string;
  actorUserId: string;
  evidenceReference: string;
  recordedAt: Date;
}
export interface SalesRevenueRow {
  paymentId: string;
  memberId: string;
  amountVnd: number;
}
export interface SalesRevenueRepository {
  record(input: SalesPaymentResponsibility): Promise<SalesPaymentResponsibility>;
  read(organizationId: string, teamId: string, start: Date, end: Date): Promise<SalesRevenueRow[]>;
}
export const SALES_REVENUE_REPOSITORY = Symbol('SALES_REVENUE_REPOSITORY');
