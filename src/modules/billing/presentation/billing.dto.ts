import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BillingCycle, PlanTier } from '../domain/billing.types';

// ─── Subscription DTOs ─────────────────────────────────────

export class CreateSubscriptionDto {
  @ApiProperty({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  @IsEnum(PlanTier)
  planTier!: PlanTier;

  @ApiProperty({ enum: BillingCycle, example: BillingCycle.MONTHLY })
  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;
}

export class UpgradeSubscriptionDto {
  @ApiProperty({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  @IsEnum(PlanTier)
  targetPlanTier!: PlanTier;
}

export class CancelSubscriptionDto {
  @ApiProperty({ example: 'Price is too high' })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({ example: 'Could improve feature X' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}

// ─── Payment DTOs ───────────────────────────────────────────

export class CreatePaymentDto {
  @ApiProperty({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  @IsEnum(PlanTier)
  planTier!: PlanTier;

  @ApiProperty({ enum: BillingCycle, example: BillingCycle.MONTHLY })
  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;
}

// ─── Casso Webhook DTO ──────────────────────────────────────

/** Shape of the Casso webhook payload for bank transactions */
export class CassoWebhookPayload {
  @ApiPropertyOptional()
  error?: number;

  @ApiPropertyOptional()
  data?: CassoTransaction[];
}

export class CassoTransaction {
  id!: number;
  tid!: string;
  description!: string;
  amount!: number;
  cusum_balance!: number;
  when!: string;
  bank_sub_acc_id!: string;
}
