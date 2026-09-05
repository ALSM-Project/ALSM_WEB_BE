import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BillingCycle,
  InvoiceStatus,
  PaymentStatus,
  PlanTier,
  SubscriptionStatus,
} from '../domain/billing.types';

// ═════════════════════════════════════════════════════════════════
// ─── REQUEST DTOs
// ═════════════════════════════════════════════════════════════════

export class CreateSubscriptionDto {
  @ApiProperty({
    enum: PlanTier,
    example: PlanTier.PROFESSIONAL,
    description: 'Plan tier to subscribe to',
  })
  @IsEnum(PlanTier)
  planTier!: PlanTier;

  @ApiProperty({
    enum: BillingCycle,
    example: BillingCycle.MONTHLY,
    description: 'Billing cycle interval (MONTHLY or ANNUAL)',
  })
  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;
}

export class UpgradeSubscriptionDto {
  @ApiProperty({
    enum: PlanTier,
    example: PlanTier.PROFESSIONAL,
    description: 'Target plan tier to upgrade to',
  })
  @IsEnum(PlanTier)
  targetPlanTier!: PlanTier;
}

export class CancelSubscriptionDto {
  @ApiProperty({
    example: 'Price is too high for our current project scope',
    description: 'Reason for cancelling the subscription',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({
    example: 'Could improve automated token extraction speed.',
    description: 'Optional additional feedback',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}

export class CreatePaymentDto {
  @ApiProperty({
    enum: PlanTier,
    example: PlanTier.PROFESSIONAL,
    description: 'Target plan tier for payment',
  })
  @IsEnum(PlanTier)
  planTier!: PlanTier;

  @ApiProperty({
    enum: BillingCycle,
    example: BillingCycle.MONTHLY,
    description: 'Billing cycle (MONTHLY or ANNUAL)',
  })
  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({
    example: 499000,
    description: 'Custom payment amount in VND (defaults to plan catalog price)',
  })
  @IsOptional()
  @IsNumber()
  amountVnd?: number;
}

export class CassoTransaction {
  @ApiProperty({ example: 123456, description: 'Casso transaction ID' })
  @IsNumber()
  id!: number;

  @ApiProperty({
    example: 'MBVCB.123456789',
    description: 'Bank transaction reference ID',
  })
  @IsString()
  tid!: string;

  @ApiProperty({
    example: 'ALSM8821 NAP TIEN PRO',
    description: 'Transaction description containing payment reference code',
  })
  @IsString()
  description!: string;

  @ApiProperty({ example: 499000, description: 'Transferred amount in VND' })
  @IsNumber()
  amount!: number;

  @ApiProperty({
    example: 12500000,
    description: 'Cumulative bank account balance after transaction',
  })
  @IsNumber()
  cusum_balance!: number;

  @ApiProperty({
    example: '2026-09-05 14:30:00',
    description: 'Transaction timestamp',
  })
  @IsString()
  when!: string;

  @ApiProperty({
    example: '090123456789',
    description: 'Bank sub-account ID',
  })
  @IsString()
  bank_sub_acc_id!: string;
}

export class CassoWebhookPayload {
  @ApiPropertyOptional({
    example: 0,
    description: 'Error code from Casso (0 = success)',
  })
  @IsOptional()
  @IsNumber()
  error?: number;

  @ApiPropertyOptional({
    type: [CassoTransaction],
    description: 'List of bank transactions received',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CassoTransaction)
  data?: CassoTransaction[];
}

// ═════════════════════════════════════════════════════════════════
// ─── RESPONSE DTOs (FOR SWAGGER DOCUMENTATION & CLIENT GENERATION)
// ═════════════════════════════════════════════════════════════════

export class PlanResponseDto {
  @ApiProperty({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  id!: PlanTier;

  @ApiProperty({ example: 'Professional' })
  name!: string;

  @ApiProperty({
    example: 'Advanced AI capabilities for high-velocity engineering workflows.',
  })
  description!: string;

  @ApiProperty({ example: 499000, description: 'Monthly price in VND' })
  monthlyPrice!: number;

  @ApiProperty({ example: 399000, description: 'Annual price per month in VND' })
  annualPrice!: number;

  @ApiProperty({ example: true })
  isPopular!: boolean;

  @ApiProperty({
    type: [String],
    example: [
      'Unlimited Projects',
      '100 Screens per month',
      '50GB Storage',
      'AI-assisted structural mapping',
      'Code review workflow',
      'Priority email support',
    ],
  })
  features!: string[];
}

export class SubscriptionResponseDto {
  @ApiProperty({ example: '66d9c84e1234567890abcdef' })
  id!: string;

  @ApiProperty({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  planTier!: PlanTier;

  @ApiProperty({ example: 'Professional' })
  planName!: string;

  @ApiProperty({ enum: SubscriptionStatus, example: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  @ApiProperty({ enum: BillingCycle, example: BillingCycle.MONTHLY })
  billingCycle!: BillingCycle;

  @ApiProperty({ example: 499000 })
  amountVnd!: number;

  @ApiPropertyOptional({ example: '2026-09-19T20:00:00.000Z', nullable: true })
  trialEndsAt?: Date | string | null;

  @ApiProperty({ example: '2026-09-05T20:00:00.000Z' })
  currentPeriodStart!: Date | string;

  @ApiProperty({ example: '2026-10-05T20:00:00.000Z' })
  currentPeriodEnd!: Date | string;

  @ApiPropertyOptional({ example: null, nullable: true })
  cancelledAt?: Date | string | null;

  @ApiProperty({ example: '2026-09-05T20:00:00.000Z' })
  createdAt!: Date | string;
}

export class CancelSubscriptionResponseDto {
  @ApiProperty({ example: '66d9c84e1234567890abcdef' })
  id!: string;

  @ApiProperty({ enum: SubscriptionStatus, example: SubscriptionStatus.CANCELLED })
  status!: SubscriptionStatus;

  @ApiProperty({ example: '2026-09-05T20:30:00.000Z' })
  cancelledAt!: Date | string;

  @ApiProperty({ example: '2026-10-05T20:00:00.000Z', description: 'Access continues until the end of paid period' })
  accessUntil!: Date | string;
}

export class UpgradePlanInfoDto {
  @ApiProperty({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  tier!: PlanTier;

  @ApiProperty({ example: 'Professional' })
  name!: string;

  @ApiPropertyOptional({ example: 499000 })
  amountVnd?: number;

  @ApiPropertyOptional({ example: 499000 })
  monthlyPriceVnd?: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['Unlimited Projects', '100 Screens per month', '50GB Storage'],
  })
  features?: string[];
}

export class ProrationDto {
  @ApiProperty({ example: 120000, description: 'Remaining credit from current subscription in VND' })
  creditRemainingVnd!: number;

  @ApiProperty({ example: 400000, description: 'Prorated cost for target subscription in VND' })
  proratedNewCostVnd!: number;

  @ApiProperty({ example: 280000, description: 'Net amount due today in VND' })
  dueTodayVnd!: number;

  @ApiProperty({ example: 24, description: 'Number of remaining days in billing cycle' })
  remainingDays!: number;
}

export class UpgradePreviewResponseDto {
  @ApiProperty({ type: UpgradePlanInfoDto })
  currentPlan!: UpgradePlanInfoDto;

  @ApiProperty({ type: UpgradePlanInfoDto })
  targetPlan!: UpgradePlanInfoDto;

  @ApiProperty({ type: ProrationDto })
  proration!: ProrationDto;
}

export class InvoiceResponseDto {
  @ApiProperty({ example: '66d9c84e1234567890abcdef' })
  id!: string;

  @ApiProperty({ example: 'INV-2026-0001' })
  invoiceNumber!: string;

  @ApiProperty({ example: 'Professional' })
  planName!: string;

  @ApiProperty({ example: 499000 })
  amountVnd!: number;

  @ApiProperty({ enum: InvoiceStatus, example: InvoiceStatus.PAID })
  status!: InvoiceStatus;

  @ApiProperty({ example: '2026-09-05T20:00:00.000Z' })
  billingPeriodStart!: Date | string;

  @ApiProperty({ example: '2026-10-05T20:00:00.000Z' })
  billingPeriodEnd!: Date | string;

  @ApiPropertyOptional({ example: '2026-09-05T20:05:00.000Z', nullable: true })
  paidAt?: Date | string | null;

  @ApiPropertyOptional({ example: 'QR Bank Transfer', nullable: true })
  paymentMethod?: string | null;

  @ApiProperty({ example: '2026-09-05T20:00:00.000Z' })
  createdAt!: Date | string;
}

export class InvoiceDownloadResponseDto {
  @ApiProperty({ example: 'Invoice PDF generation queued' })
  message!: string;

  @ApiProperty({ example: '/api/v1/billing/invoices/sample-receipt.pdf' })
  downloadUrl!: string;
}

export class UsageStatsItemDto {
  @ApiProperty({ example: 12, description: 'Used quantity in current cycle' })
  used!: number;

  @ApiProperty({ example: 100, description: 'Maximum allowed (-1 for unlimited)' })
  max!: number;
}

export class UsageStorageDto {
  @ApiProperty({ example: 2.5, description: 'Used storage in GB' })
  usedGb!: number;

  @ApiProperty({ example: 50, description: 'Maximum storage limit in GB (-1 for unlimited)' })
  maxGb!: number;
}

export class MonthlyConversionItemDto {
  @ApiProperty({ example: 'Sep', description: 'Month name abbreviation' })
  month!: string;

  @ApiProperty({ example: 45, description: 'Total conversions processed in this month' })
  count!: number;
}

export class UsageStatsPlanDto {
  @ApiPropertyOptional({ enum: PlanTier, example: PlanTier.PROFESSIONAL })
  tier?: PlanTier;

  @ApiPropertyOptional({ example: 'Professional' })
  name?: string;
}

export class UsageStatsResponseDto {
  @ApiProperty({ type: UsageStatsPlanDto })
  plan!: UsageStatsPlanDto;

  @ApiProperty({ type: UsageStatsItemDto })
  screens!: UsageStatsItemDto;

  @ApiProperty({ type: UsageStatsItemDto })
  projects!: UsageStatsItemDto;

  @ApiProperty({ type: UsageStorageDto })
  storage!: UsageStorageDto;

  @ApiProperty({ type: [MonthlyConversionItemDto] })
  monthlyConversions!: MonthlyConversionItemDto[];
}

export class PaymentOrderResponseDto {
  @ApiProperty({ example: '66d9c84e1234567890abcdef' })
  paymentId!: string;

  @ApiPropertyOptional({ example: '66d9c84e1234567890abcdef', nullable: true })
  subscriptionId?: string | null;

  @ApiProperty({ example: 'INV-2026-0001' })
  invoiceNumber!: string;

  @ApiProperty({ example: 'PROFESSIONAL' })
  planName!: string;

  @ApiProperty({ example: 499000 })
  amountVnd!: number;

  @ApiProperty({ example: 'VND' })
  currency!: string;

  @ApiProperty({ example: 'ALSM8821' })
  referenceCode!: string;

  @ApiProperty({
    example:
      'https://img.vietqr.io/image/MB-090123456789-compact2.png?amount=499000&addInfo=ALSM8821&accountName=CONG%20TY%20COPHANA%20ALSM%20SOFTWARE',
    description: 'Direct URL to VietQR code image',
  })
  qrDataUrl!: string;

  @ApiProperty({ example: 'MBBank (Ngan hang Quan doi)' })
  bankName!: string;

  @ApiProperty({ example: '090123456789' })
  accountNumber!: string;

  @ApiProperty({ example: 'CONG TY COPHANA ALSM SOFTWARE' })
  accountName!: string;

  @ApiProperty({ example: '2026-09-05T20:45:00.000Z' })
  expiresAt!: string;
}

export class PaymentStatusResponseDto {
  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.COMPLETED })
  status!: PaymentStatus;

  @ApiPropertyOptional({ example: '2026-09-05T20:32:00.000Z', nullable: true })
  paidAt!: Date | string | null;

  @ApiProperty({ example: 499000 })
  amountVnd!: number;
}

export class CassoWebhookResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Number of transactions processed' })
  processed?: number;

  @ApiPropertyOptional({ example: 1, description: 'Number of transactions successfully matched' })
  matched?: number;

  @ApiPropertyOptional({ example: 'No transactions to process' })
  message?: string;

  @ApiPropertyOptional({ example: 'Casso reported an error' })
  error?: string;
}
