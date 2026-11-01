import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { OrganizationType } from '../../../organizations/domain/organization.types';

const ORGANIZATION_TYPES = [
  'ALL',
  ...Object.values(OrganizationType),
  // Legacy values still present in older organization records.
  'STANDARD',
  'PARTNER',
];
const ORGANIZATION_STATUSES = ['ALL', 'ACTIVE', 'TRIAL', 'SUSPENDED'];

export class ListOrganizationsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(ORGANIZATION_TYPES)
  type?: string;

  @IsOptional()
  @IsIn(ORGANIZATION_STATUSES)
  status?: string;
}
