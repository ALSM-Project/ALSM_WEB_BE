import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class OnboardUserDto {
  @ApiProperty({ example: 'alex.vance@acmecorp.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Alex Vance' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @ApiProperty({ example: 'MEMBER', description: 'RBAC role id to assign (e.g. TEAM_LEAD, MEMBER)' })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiProperty({ example: 'TmpPass123!', description: 'Temporary password set by the admin' })
  @IsString()
  @MinLength(8)
  temporaryPassword!: string;

  @ApiPropertyOptional({ description: 'Target organization; defaults to the caller organization' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateUserStatusDto {
  @ApiProperty({ description: 'New active state' })
  @IsIn([true, false])
  isActive!: boolean;
}

export class OnboardedUserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() role!: string;
  @ApiPropertyOptional() organizationId?: string;
}
