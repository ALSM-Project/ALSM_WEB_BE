import { ServiceUnavailableException } from '@nestjs/common';

import type { SendSmsOtpInput, SmsDeliveryResult, SmsVerificationPort } from '../domain/sms-verification.port';

/**
 * Default SMS adapter that rejects every call.
 *
 * Wired in when no real SMS provider is configured — keeps phone verification
 * fail-closed rather than silently succeeding without delivery.
 */
export class UnconfiguredSmsAdapter implements SmsVerificationPort {
  async sendOtp(input: SendSmsOtpInput): Promise<SmsDeliveryResult> {
    void input;
    throw new ServiceUnavailableException({
      code: 'SMS_PROVIDER_NOT_CONFIGURED',
      message:
        'Phone verification is unavailable because no SMS provider is configured. ' +
        'Set SMS_PROVIDER and the corresponding credentials in the environment.',
    });
  }
}

