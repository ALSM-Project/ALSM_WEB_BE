import { AuditRepository } from '../../audit/domain/audit.repository';
import { SalesRevenueRepository } from '../../billing/domain/sales-revenue.port';
import { LeadRepository } from '../domain/lead.types';
export interface SalesMutationRepositories {
  leads: LeadRepository;
  revenue: SalesRevenueRepository;
  audit: AuditRepository;
}
export interface SalesUnitOfWork {
  run<T>(
    work: (repositories: SalesMutationRepositories) => Promise<T>,
    resourceId: string,
  ): Promise<T>;
}
export const SALES_UNIT_OF_WORK = Symbol('SALES_UNIT_OF_WORK');
