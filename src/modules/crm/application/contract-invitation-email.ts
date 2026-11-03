import { ConfigService } from '@nestjs/config';
import { EmailMessage } from '../../auth/domain/email.port';

export function contractInvitationEmail(
  config: ConfigService,
  email: string,
  token: string,
): EmailMessage {
  const baseUrl = (config.get<string>('APP_BASE_URL') || 'http://localhost:5173').replace(/\/+$/, '');
  const invitationUrl = `${baseUrl}/prospect-invitation#token=${encodeURIComponent(token)}`;
  return {
    to: email,
    subject: 'ALSM customer invitation',
    html:
      '<p>You have been invited to access an ALSM customer contract.</p>' +
      '<p>Open the invitation, then sign in or create your account and verify your email to continue.</p>' +
      `<p><a href="${escapeHtml(invitationUrl)}">Open invitation</a></p>` +
      '<p>This one-time invitation expires in seven days. Do not forward this message.</p>',
    text: `You have been invited to access an ALSM customer contract. Sign in or create your account and verify your email to continue: ${invitationUrl}\nThis one-time invitation expires in seven days. Do not forward this message.`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}
