import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailDeliveryStatus, EmailMessage, EmailPort } from '../domain/email.port';

@Injectable()
export class SmtpEmailAdapter implements EmailPort {
  private readonly logger = new Logger(SmtpEmailAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: EmailMessage): Promise<EmailDeliveryStatus> {
    const host = this.config.get<string>('SMTP_HOST') || '';
    const user = this.config.get<string>('SMTP_USER') || '';

    if (!host || !user) {
      this.logger.warn('SMTP not configured; email delivery was skipped.');
      return 'NOT_CONFIGURED';
    }

    const transport = nodemailer.createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT') || 587,
      secure: this.config.get<boolean>('SMTP_SECURE') ?? false,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 60_000,
      auth: {
        user,
        pass: this.config.get<string>('SMTP_PASS') || '',
      },
    });

    try {
      await transport.sendMail({
        from: this.config.get<string>('SMTP_FROM') || user,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    } finally {
      transport.close();
    }
    return 'SENT';
  }
}
