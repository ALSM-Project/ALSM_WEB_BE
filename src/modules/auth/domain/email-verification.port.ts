import { UserRecord } from '../../users/domain/user.repository';
import { EmailDeliveryStatus } from './email.port';

export interface EmailVerificationPort {
  sendVerificationEmail(user: UserRecord): Promise<EmailDeliveryStatus>;
}

export const EMAIL_VERIFICATION_PORT = Symbol('EMAIL_VERIFICATION_PORT');
