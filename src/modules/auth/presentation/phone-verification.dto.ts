import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, Length } from 'class-validator';

/* ── Request DTOs ──────────────────────────────────────────────────── */

export class RequestPhoneOtpDto {
  @ApiProperty({
    description: 'E.164 phone number, e.g. "+84901234567".',
    example: '+84901234567',
  })
  @IsString()
  @Matches(/^\+84\d{9,10}$/, {
    message: 'phone must be a Vietnamese E.164 number (+84 followed by 9–10 digits)',
  })
  phone!: string;
}

export class VerifyPhoneOtpDto {
  @ApiProperty({
    description: 'E.164 phone number used when requesting the OTP.',
    example: '+84901234567',
  })
  @IsString()
  @Matches(/^\+84\d{9,10}$/, {
    message: 'phone must be a Vietnamese E.164 number (+84 followed by 9–10 digits)',
  })
  phone!: string;

  @ApiProperty({
    description: '6-digit OTP code received via SMS.',
    example: '123456',
  })
  @IsString()
  @Length(6, 6, { message: 'code must be exactly 6 digits' })
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;
}

/* ── Response DTOs ─────────────────────────────────────────────────── */

export class PhoneOtpRequestedResponse {
  @ApiProperty({ description: 'Whether the OTP was accepted for delivery.' })
  sent!: boolean;

  @ApiProperty({ description: 'Seconds the client must wait before requesting a new OTP.' })
  retryAfterSeconds!: number;
}

export class PhoneVerificationStatusResponse {
  @ApiProperty({
    description: 'Current phone verification status.',
    enum: ['UNVERIFIED', 'PENDING', 'VERIFIED'],
  })
  status!: 'UNVERIFIED' | 'PENDING' | 'VERIFIED';

  @ApiPropertyOptional({
    description: 'The verified phone number (masked). Only present when status is VERIFIED.',
    example: '+84******567',
  })
  phone?: string;
}

export class PhoneOtpVerifiedResponse {
  @ApiProperty({ description: 'Whether the OTP was valid and the phone is now verified.' })
  verified!: boolean;
}

