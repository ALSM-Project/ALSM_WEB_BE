import { IsIn, IsOptional } from 'class-validator';

export const SALES_REPORT_PERIODS = ['ALL', '30D', '90D', 'YTD'] as const;
export type SalesReportPeriod = (typeof SALES_REPORT_PERIODS)[number];

export class SalesReportQueryDto {
  @IsOptional()
  @IsIn(SALES_REPORT_PERIODS)
  dateRange: SalesReportPeriod = 'ALL';
}
