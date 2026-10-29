import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SALES_PIPELINE_STAGES, SalesPipelineStageFilter } from '../domain/sales-pipeline.types';

const FILTERABLE_STAGES: SalesPipelineStageFilter[] = [
  'ALL',
  ...SALES_PIPELINE_STAGES.filter((stage) => stage !== 'UNMAPPED'),
];

export class SalesPipelineQueryDto {
  @IsOptional()
  @IsIn(FILTERABLE_STAGES)
  stage?: SalesPipelineStageFilter;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(120)
  search?: string;
}
