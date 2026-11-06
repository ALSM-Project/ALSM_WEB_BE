/**
 * Port for sending SMS verification codes.
 *
 * Adapters must deliver the OTP to the given phone number via a real SMS
 * gateway.  The default {@link UnconfiguredSmsAdapter} rejects every call so
 * that phone verification stays unavailable until a real provider is wired in.
 */
export interface SmsVerificationPort {
  /**
   * Send a one-time verification code to {@link phone}.
   *
   * @returns delivery metadata on success.
   * @throws ServiceUnavailableException when the adapter is not configured or
   *         the downstream provider is unreachable.
   */
  sendOtp(input: SendSmsOtpInput): Promise<SmsDeliveryResult>;
}

export interface SendSmsOtpInput {
  /** E.164 phone number, e.g. "+84901234567". */
  readonly phone: string;
  /** 6-digit OTP code to deliver. */
  readonly code: string;
  /** Human-readable purpose for the SMS body, e.g. "xác minh số điện thoại". */
  readonly purpose: string;
}

export interface SmsDeliveryResult {
  /** Whether the gateway accepted the message for delivery. */
  readonly accepted: boolean;
  /** Provider-assigned message/request ID for traceability (never logged with PII). */
  readonly providerMessageId?: string;
}

export const SMS_VERIFICATION_PORT = Symbol('SMS_VERIFICATION_PORT');

