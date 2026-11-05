import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReviewContractDto {
  @ApiProperty({ enum: ['APPROVE', 'RETURN', 'REJECT'] })
  @IsIn(['APPROVE', 'RETURN', 'REJECT'])
  action!: 'APPROVE' | 'RETURN' | 'REJECT';

  @ApiProperty({ required: false, maxLength: 1000, description: 'Required for return/reject; approval remains blocked until a Legal-approved template is configured.' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;
}

export class CustomerContractDecisionDto {
  @ApiProperty({ enum: ['REQUEST_CHANGES', 'DECLINE'] })
  @IsIn(['REQUEST_CHANGES', 'DECLINE'])
  action!: 'REQUEST_CHANGES' | 'DECLINE';

  @ApiProperty({ minLength: 5, maxLength: 1000, description: 'The reason is shown to Sales and retained in the contract audit.' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;
}

export class DemoSigningConfirmationDto {
  @ApiProperty({ description: 'Must be true to acknowledge that this is a demo simulation with no legal effect.' })
  @IsBoolean()
  acknowledged!: boolean;
}
