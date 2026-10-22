import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST', '');
    const port = this.config.get<number>('SMTP_PORT', 587);
    const secure = this.config.get<boolean>('SMTP_SECURE', false);
    const user = this.config.get<string>('SMTP_USER', '');
    const pass = this.config.get<string>('SMTP_PASS', '');
    const rawFrom = this.config.get<string>('SMTP_FROM', '') || user || 'noreply@alsm.io';

    // Normalize to RFC 5322: if no angle brackets, use display name + email
    this.fromAddress = rawFrom.includes('<') ? rawFrom : `"ALSM Enterprise" <${rawFrom}>`;

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
      });
      this.logger.log(`MailService initialized — SMTP host: ${host}:${port} | from: ${this.fromAddress}`);
    } else {
      this.logger.warn('SMTP_HOST not configured — email sending is DISABLED (emails will be logged only)');
    }
  }

  /**
   * Send a Google Meet invitation email to a single attendee.
   */
  async sendMeetingInvite(params: {
    to: string;
    hostName: string;
    hostEmail: string;
    meetingTitle: string;
    meetingUrl: string;
    scheduledStartTime: Date;
    scheduledEndTime: Date;
    description: string;
    projectName: string;
  }): Promise<void> {
    const {
      to,
      hostName,
      hostEmail,
      meetingTitle,
      meetingUrl,
      scheduledStartTime,
      scheduledEndTime,
      description,
      projectName,
    } = params;

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const formattedStart = dateFormatter.format(scheduledStartTime);
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const formattedEnd = timeFormatter.format(scheduledEndTime);

    const subject = `[ALSM] You're invited: ${meetingTitle}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Meeting Invitation</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#00AC47 0%,#0052CC 100%);padding:32px 40px;text-align:center;">
              <div style="display:inline-block;background:rgba(255,255,255,.15);border-radius:12px;padding:12px 20px;">
                <span style="font-size:28px;">📹</span>
              </div>
              <h1 style="color:#fff;margin:16px 0 4px;font-size:22px;font-weight:700;">Google Meet Invitation</h1>
              <p style="color:rgba(255,255,255,.85);margin:0;font-size:14px;">You have been invited to an online meeting</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="color:#091E42;font-size:16px;margin:0 0 24px;">Hello,</p>
              <p style="color:#42526E;font-size:14px;line-height:1.6;margin:0 0 24px;">
                <strong style="color:#091E42;">${hostName}</strong> (${hostEmail}) has invited you to a Google Meet online meeting.
              </p>

              <!-- Meeting Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;border:1px solid #D9E2EC;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <h2 style="color:#091E42;font-size:18px;font-weight:700;margin:0 0 20px;">${meetingTitle}</h2>

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;vertical-align:top;width:28px;color:#0652CC;">📅</td>
                        <td style="padding:6px 0;color:#091E42;font-size:14px;">
                          <strong>${formattedStart}</strong> – ${formattedEnd} (Vietnam Time)
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;vertical-align:top;width:28px;color:#0652CC;">📁</td>
                        <td style="padding:6px 0;color:#42526E;font-size:14px;">
                          Project: <strong>${projectName}</strong>
                        </td>
                      </tr>
                      ${description ? `
                      <tr>
                        <td style="padding:6px 0;vertical-align:top;width:28px;color:#0652CC;">📝</td>
                        <td style="padding:6px 0;color:#42526E;font-size:14px;">${description}</td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center">
                    <a href="${meetingUrl}"
                       style="display:inline-block;background:#0652CC;color:#fff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:.3px;">
                      Join Google Meet
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Meet Link -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#E8F1FF;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:14px 18px;">
                    <p style="margin:0;font-size:11px;color:#42526E;text-transform:uppercase;letter-spacing:.8px;font-weight:600;margin-bottom:6px;">Meeting Link</p>
                    <a href="${meetingUrl}" style="color:#0652CC;font-family:monospace;font-size:13px;font-weight:600;text-decoration:none;">${meetingUrl}</a>
                  </td>
                </tr>
              </table>

              <p style="color:#6B778C;font-size:12px;line-height:1.5;margin:0;">
                If you cannot attend, please inform <strong>${hostEmail}</strong> as soon as possible.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F7F9FC;border-top:1px solid #D9E2EC;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#6B778C;">
                This invitation was sent automatically by <strong>ALSM Enterprise Platform</strong>.<br/>
                Do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    if (!this.transporter) {
      // Dev fallback: just log the email content
      this.logger.log(`[EMAIL SKIPPED - No SMTP] To: ${to} | Subject: ${subject} | Meet: ${meetingUrl}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from: `"ALSM Enterprise" <${this.fromAddress}>`,
        to,
        subject,
        html,
      });
      this.logger.log(`Meeting invite sent to ${to} for meeting: ${meetingTitle}`);
    } catch (err: unknown) {
      // Log but don't throw — email failure should not break meeting creation
      this.logger.error(`Failed to send meeting invite to ${to}: ${(err as Error).message}`);
    }
  }

  /**
   * UC-48: tells a partner their modernized code bundle is ready. Returns false when SMTP is
   * not configured (nothing was sent) and throws when the SMTP server rejects the message,
   * so the caller can record the real delivery outcome.
   */
  async sendPartnerExportNotification(params: {
    to: string;
    projectName: string;
    packageName: string;
    targetFramework: string;
    includedCount: number;
    excludedItems: { name: string; reason: string }[];
    customNotes?: string;
    portalUrl: string;
  }): Promise<boolean> {
    const esc = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const { to, projectName, packageName, targetFramework, includedCount, excludedItems, portalUrl } =
      params;
    const notes = params.customNotes?.trim();
    const subject = `[ALSM] Modernized Code Bundle Ready: ${projectName}`;

    const excludedRows = excludedItems.length
      ? `
              <p style="color:#091E42;font-size:14px;font-weight:700;margin:24px 0 8px;">Not included (${excludedItems.length})</p>
              <ul style="color:#42526E;font-size:13px;line-height:1.6;margin:0;padding-left:20px;">
                ${excludedItems.map((i) => `<li><strong>${esc(i.name)}</strong>: ${esc(i.reason)}</li>`).join('')}
              </ul>`
      : '';
    const notesBlock = notes
      ? `
              <p style="color:#091E42;font-size:14px;font-weight:700;margin:24px 0 8px;">Notes from the conversion team</p>
              <div style="background:#F7F9FC;border:1px solid #D9E2EC;border-radius:8px;padding:14px 18px;color:#42526E;font-size:13px;line-height:1.6;white-space:pre-wrap;">${esc(notes)}</div>`
      : '';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Code Bundle Ready</title>
</head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);">
          <tr>
            <td style="background:#0652CC;padding:28px 40px;">
              <h1 style="color:#fff;margin:0 0 4px;font-size:20px;font-weight:700;">Your modernized code bundle is ready</h1>
              <p style="color:rgba(255,255,255,.85);margin:0;font-size:14px;">${esc(projectName)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FC;border:1px solid #D9E2EC;border-radius:10px;">
                <tr><td style="padding:18px 24px;color:#42526E;font-size:14px;line-height:1.8;">
                  Package: <strong style="color:#091E42;font-family:monospace;">${esc(packageName)}</strong><br/>
                  Target: <strong style="color:#091E42;">${esc(targetFramework)}</strong><br/>
                  Converted items included: <strong style="color:#091E42;">${includedCount}</strong>
                </td></tr>
              </table>
              ${excludedRows}
              ${notesBlock}
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
                <tr>
                  <td align="center">
                    <a href="${esc(portalUrl)}"
                       style="display:inline-block;background:#0652CC;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:12px 32px;border-radius:8px;">
                      Open Partner Download Center
                    </a>
                  </td>
                </tr>
              </table>
              <p style="color:#6B778C;font-size:12px;line-height:1.5;margin:16px 0 0;">
                The package includes a README with setup steps. Contact your ALSM conversion team if anything is missing.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F7F9FC;border-top:1px solid #D9E2EC;padding:18px 40px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#6B778C;">Sent automatically by <strong>ALSM Enterprise Platform</strong>. Do not reply to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = [
      `Your modernized code bundle for ${projectName} is ready.`,
      `Package: ${packageName}`,
      `Target: ${targetFramework}`,
      `Converted items included: ${includedCount}`,
      ...(excludedItems.length
        ? ['', 'Not included:', ...excludedItems.map((i) => `- ${i.name}: ${i.reason}`)]
        : []),
      ...(notes ? ['', 'Notes from the conversion team:', notes] : []),
      '',
      `Partner Download Center: ${portalUrl}`,
    ].join('\n');

    if (!this.transporter) {
      this.logger.warn(`[EMAIL SKIPPED - No SMTP] To: ${to} | Subject: ${subject}`);
      return false;
    }

    await this.transporter.sendMail({ from: this.fromAddress, to, subject, html, text });
    this.logger.log(`Export notification sent to ${to} for ${packageName}`);
    return true;
  }
}
