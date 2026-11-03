import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SupportOrganizationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['SELF_SERVICE', 'ENTERPRISE'] }) type!: string;
  @ApiProperty({ enum: ['ACTIVE', 'TRIAL'] }) status!: string;
}

export class SupportOrganizationPageDto {
  @ApiProperty({ type: [SupportOrganizationResponseDto] }) items!: SupportOrganizationResponseDto[];
  @ApiProperty({ type: String, nullable: true }) nextAfterId!: string | null;
}

export class SupportContextResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty({ type: Boolean, enum: [true] }) readOnly!: true;
  @ApiProperty({ enum: ['ACTIVE', 'EXITED', 'EXPIRED', 'REVOKED'] }) state!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) lastActivityAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) idleExpiresAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt!: Date | null;
}

export class SupportOrganizationSearchDto {
  @ApiProperty({ minLength: 3, maxLength: 120 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 120)
  @Matches(/^[^\p{Cc}]+$/u)
  query!: string;

  @ApiPropertyOptional({ enum: ['name', 'email'], default: 'name' })
  @IsIn(['name', 'email'])
  field: 'name' | 'email' = 'name';

  @ApiPropertyOptional({ minimum: 1, maximum: 25, default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit = 10;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-f0-9]{24}$/)
  afterId?: string;
}

export class SupportOrganizationParamsDto {
  @ApiProperty()
  @Matches(/^[a-f0-9]{24}$/)
  organizationId!: string;
}

export class SupportContextParamsDto extends SupportOrganizationParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  @Matches(/^[a-f0-9-]+$/)
  contextId!: string;
}

/** Any caller-supplied role, permission, lifetime or writable mode is rejected. */
export class EmptySupportContextDto {}
