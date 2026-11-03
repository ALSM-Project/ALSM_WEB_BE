export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type EmailDeliveryStatus = 'SENT' | 'NOT_CONFIGURED' | 'UNCONFIRMED';

export interface EmailPort {
  /** `void` remains accepted for existing test adapters; callers must treat it as unconfirmed. */
  send(message: EmailMessage): Promise<EmailDeliveryStatus | void>;
}

export const EMAIL_PORT = Symbol('EMAIL_PORT');
