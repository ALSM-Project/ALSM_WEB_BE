import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  EmploymentStatus,
  MembershipStatus,
  WorkforceMemberType,
} from '../../organizations/domain/organization.types';

export class SearchWorkforceQueryDto {
  @ApiPropertyOptional({ description: 'Search term for name, email, employee code, department' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['WEB2', 'WEB3'], description: 'Calling portal context' })
  @IsOptional()
  @IsEnum(['WEB2', 'WEB3'])
  portal?: 'WEB2' | 'WEB3';

  @ApiPropertyOptional({ description: 'Organization scope filter' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({
    enum: WorkforceMemberType,
    description: 'Workforce member type filter',
  })
  @IsOptional()
  @IsEnum(WorkforceMemberType)
  memberType?: WorkforceMemberType;

  @ApiPropertyOptional({
    description: 'Membership status filter (ACTIVE, OFFBOARDED, SUSPENDED, ALL)',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 10;
}

export class WorkforceEmployeeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  membershipId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  employeeCode!: string;

  @ApiProperty()
  department!: string;

  @ApiPropertyOptional()
  teamId?: string;

  @ApiPropertyOptional()
  teamName?: string;

  @ApiProperty()
  role!: string;

  @ApiProperty({ enum: WorkforceMemberType })
  memberType!: WorkforceMemberType;

  @ApiProperty({ enum: MembershipStatus })
  status!: MembershipStatus;

  @ApiProperty({ enum: EmploymentStatus })
  employmentStatus!: EmploymentStatus;

  @ApiProperty()
  organizationId!: string;

  @ApiPropertyOptional()
  organizationName?: string;

  @ApiProperty()
  activeWorkload!: number;

  @ApiProperty()
  maxCapacity!: number;

  @ApiPropertyOptional()
  avatarUrl?: string;

  @ApiPropertyOptional()
  roles?: string[];
}

export class WorkforceSearchResponseDto {
  @ApiProperty({ type: [WorkforceEmployeeDto] })
  items!: WorkforceEmployeeDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}
