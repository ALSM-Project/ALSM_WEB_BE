export const SALES_PIPELINE_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
  'UNMAPPED',
] as const;

export type SalesPipelineStage = (typeof SALES_PIPELINE_STAGES)[number];
export type SalesPipelineStageFilter = Exclude<SalesPipelineStage, 'UNMAPPED'> | 'ALL';

export interface SalesPipelineLead {
  id: string;
  company: string;
  contactName: string;
  source: string;
  stage: SalesPipelineStage;
  score?: number;
  dealValue?: number;
  currency: 'VND';
  assignedToName?: string;
  lastContactAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface SalesPipelineQuery {
  organizationId?: string;
  stage?: SalesPipelineStageFilter;
  search?: string;
}

export interface SalesPipelineView {
  items: SalesPipelineLead[];
  total: number;
  stageCounts: Record<SalesPipelineStage, number>;
  lastUpdated: Date;
}
