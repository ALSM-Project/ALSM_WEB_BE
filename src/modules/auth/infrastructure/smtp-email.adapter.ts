import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailMessage, EmailPort } from '../domain/email.port';

@Injectable()
export class SmtpEmailAdapter implements EmailPort {
  private readonly logger = new Logger(SmtpEmailAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async send(message: EmailMessage): Promise<void> {
    const host = this.config.get<string>('SMTP_HOST') || '';
    const user = this.config.get<string>('SMTP_USER') || '';

    if (!host || !user) {
      this.logger.warn(
        `SMTP not configured; skipping email to ${message.to} (subject: ${message.subject})`,
      );
      return;
    }

    const transport = nodemailer.createTransport({
      host,
      port: this.config.get<number>('SMTP_PORT') || 587,
      secure: this.config.get<boolean>('SMTP_SECURE') ?? false,
      auth: {
        user,
        pass: this.config.get<string>('SMTP_PASS') || '',
      },
    });

    await transport.sendMail({
      from: this.config.get<string>('SMTP_FROM') || user,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
