/**
 * Enterprise Email Template Renderer for ALSM CRM
 * Fully English corporate template styled with ALSM Web 2 Design System
 * Background palette: #EEF1F6 (workspace), #14263F (corporate navy), #244A70 (corporate primary), #DCE3EC (border)
 * Clean B2B formatting with NO emojis / icons.
 */

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EnterpriseEmailOptions {
  subject: string;
  content: string;
  companyName?: string;
  contactName?: string;
  referenceCode?: string;
}

export function renderEnterpriseCrmEmailHtml(options: EnterpriseEmailOptions): string {
  const { subject, content, referenceCode } = options;

  const rawLines = content.split('\n');
  const renderedSections: string[] = [];

  let inNumberedList = false;
  let currentListItems: { num: string; label: string; value: string }[] = [];

  const flushNumberedList = () => {
    if (currentListItems.length > 0) {
      const rows = currentListItems
        .map((item, idx) => {
          const bg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
          const isValueEmpty = !item.value || item.value.trim() === '';
          const displayValue = isValueEmpty
            ? '<span style="color: #8491A3; font-style: italic;">[To be provided]</span>'
            : `<strong style="color: #17263A; font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;">${escapeHtml(item.value)}</strong>`;

          return `
            <tr style="background-color: ${bg}; border-bottom: 1px solid #DCE3EC;">
              <td style="padding: 10px 14px; font-size: 13px; color: #4D6B8C; width: 44%; vertical-align: top; font-weight: 600;">
                <span style="display: inline-block; width: 20px; height: 20px; line-height: 20px; text-align: center; background: #DCE3EC; color: #14263F; border-radius: 4px; font-size: 11px; font-weight: 700; margin-right: 8px;">${escapeHtml(item.num)}</span>
                ${escapeHtml(item.label)}
              </td>
              <td style="padding: 10px 14px; font-size: 13px; color: #17263A; width: 56%; vertical-align: top;">
                ${displayValue}
              </td>
            </tr>
          `;
        })
        .join('');

      renderedSections.push(`
        <div style="margin: 22px 0; border: 1px solid #DCE3EC; border-radius: 6px; overflow: hidden;">
          <div style="background: #EEF1F6; padding: 10px 16px; border-bottom: 1px solid #DCE3EC;">
            <span style="font-size: 11px; font-weight: 700; color: #14263F; text-transform: uppercase; letter-spacing: 0.8px;">
              LEGAL ENTITY INTAKE DIRECTORY
            </span>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            ${rows}
          </table>
        </div>
      `);
      currentListItems = [];
      inNumberedList = false;
    }
  };

  let bufferParagraphs: string[] = [];
  const flushParagraphs = () => {
    if (bufferParagraphs.length > 0) {
      const text = bufferParagraphs.join('<br />');
      renderedSections.push(`<p style="margin: 0 0 14px 0; font-size: 14px; line-height: 1.7; color: #17263A;">${text}</p>`);
      bufferParagraphs = [];
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();

    if (!line) {
      if (inNumberedList) flushNumberedList();
      flushParagraphs();
      continue;
    }

    // Commercial Agreement Summary block
    if (
      line.startsWith('COMMERCIAL AGREEMENT SUMMARY:') ||
      line.startsWith('COMMERCIAL OVERVIEW:') ||
      line.includes('Solution Package:') ||
      line.includes('Project Scope:') ||
      line.includes('Commercial Value:')
    ) {
      flushParagraphs();
      if (inNumberedList) flushNumberedList();

      renderedSections.push(`
        <div style="background: #EEF1F6; border-left: 4px solid #244A70; border-radius: 0 6px 6px 0; padding: 14px 18px; margin: 16px 0; border-top: 1px solid #DCE3EC; border-right: 1px solid #DCE3EC; border-bottom: 1px solid #DCE3EC;">
          <div style="font-size: 11px; font-weight: 700; color: #244A70; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 4px;">
            COMMERCIAL AGREEMENT SUMMARY
          </div>
          <div style="font-size: 13px; color: #17263A; line-height: 1.6; font-weight: 500;">
            ${escapeHtml(line.replace('COMMERCIAL AGREEMENT SUMMARY:', '').trim() || line)}
          </div>
        </div>
      `);
      continue;
    }

    // Numbered item: "1. Registered Corporate Name: ..."
    const numberedMatch = line.match(/^(\d+)[\.\)]\s+([^:]+):?(.*)$/);
    if (numberedMatch) {
      flushParagraphs();
      inNumberedList = true;
      currentListItems.push({
        num: numberedMatch[1],
        label: numberedMatch[2].trim(),
        value: (numberedMatch[3] || '').trim(),
      });
      continue;
    }

    if (inNumberedList) {
      flushNumberedList();
    }

    // Salutation
    if (line.startsWith('Dear ')) {
      flushParagraphs();
      renderedSections.push(`
        <div style="font-size: 15px; font-weight: 700; color: #14263F; margin: 0 0 14px 0; padding-bottom: 4px;">
          ${escapeHtml(line)}
        </div>
      `);
      continue;
    }

    // Sign-off
    if (line.startsWith('Sincerely') || line.startsWith('Best regards') || line.startsWith('Regards')) {
      flushParagraphs();
      const remainingLines = rawLines.slice(i).map(l => l.trim()).filter(Boolean);
      renderedSections.push(`
        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #DCE3EC;">
          <div style="font-size: 13px; color: #8491A3; margin-bottom: 6px;">${escapeHtml(remainingLines[0] || 'Sincerely,')}</div>
          <div style="font-size: 14px; font-weight: 700; color: #14263F; line-height: 1.6;">
            ${remainingLines.slice(1).map(l => escapeHtml(l)).join('<br />')}
          </div>
        </div>
      `);
      break;
    }

    bufferParagraphs.push(escapeHtml(line));
  }

  flushNumberedList();
  flushParagraphs();

  const bodyHtml = renderedSections.join('\n');
  const docRef = referenceCode || `LEI-${Date.now().toString(36).toUpperCase()}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #EEF1F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #17263A; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 650px; margin: 0 auto; background-color: #FFFFFF; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(20, 38, 63, 0.08); border: 1px solid #DCE3EC;">
    <!-- Top Corporate Accent Bar -->
    <tr>
      <td height="4" style="background: #244A70; line-height: 4px; font-size: 4px;">&nbsp;</td>
    </tr>

    <!-- Header Banner in Web 2 Corporate Navy -->
    <tr>
      <td style="background: #14263F; padding: 24px 32px; color: #FFFFFF;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: middle;">
              <div style="font-size: 19px; font-weight: 800; letter-spacing: 0.6px; color: #FFFFFF; font-family: 'Segoe UI', Arial, sans-serif;">
                ALSM ENTERPRISE PLATFORM
              </div>
              <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.2px; color: #8491A3; margin-top: 4px;">
                Modernization &amp; Enterprise Solutions
              </div>
            </td>
            <td style="text-align: right; vertical-align: middle;">
              <span style="display: inline-block; padding: 4px 10px; background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; color: #FFFFFF; font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;">
                OFFICIAL NOTICE
              </span>
              <div style="font-size: 10px; color: #8491A3; margin-top: 4px; font-family: monospace;">Ref: ${escapeHtml(docRef)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Sub-header Bar -->
    <tr>
      <td style="background: #EEF1F6; border-bottom: 1px solid #DCE3EC; padding: 12px 32px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="font-size: 12px; font-weight: 600; color: #14263F;">
              Legal Entity Intake Notice for Electronic Contract Execution
            </td>
            <td style="text-align: right; font-size: 11px; color: #8491A3; text-transform: uppercase; letter-spacing: 0.5px;">
              Confidential
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Main Content Area -->
    <tr>
      <td style="padding: 28px 32px 20px 32px;">
        ${bodyHtml}

        <!-- Response Instructions Box -->
        <div style="margin: 22px 0 16px 0; background: #EEF1F6; border: 1px solid #DCE3EC; border-radius: 6px; padding: 14px 18px;">
          <div style="font-size: 12px; font-weight: 700; color: #14263F; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 4px;">
            RESPONSE INSTRUCTIONS
          </div>
          <div style="font-size: 12px; color: #17263A; line-height: 1.6;">
            Please reply directly to this email with the completed legal entity details listed above, or attach your official Business License / Certificate of Incorporation. Upon receipt, our legal team will dispatch the agreement via our secure digital signing portal.
          </div>
        </div>

        <!-- Compliance & Security Assurance Note -->
        <div style="margin: 16px 0; background: #FFFFFF; border: 1px solid #DCE3EC; border-radius: 6px; padding: 12px 16px;">
          <div style="font-size: 11px; font-weight: 700; color: #4D6B8C; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">
            LEGAL &amp; SECURITY ASSURANCE
          </div>
          <div style="font-size: 11px; color: #8491A3; line-height: 1.5;">
            The ALSM Electronic Contract execution workflow is compliant with official Electronic Transactions legislation, verified with cryptographic timestamping (SHA-256), and protected under ISO/IEC 27001 data governance standards.
          </div>
        </div>
      </td>
    </tr>

    <!-- Enterprise Footer in Web 2 Corporate Navy -->
    <tr>
      <td style="background-color: #14263F; border-top: 1px solid #203954; padding: 24px 32px; color: #8491A3;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align: top; width: 60%;">
              <div style="font-size: 12px; font-weight: 700; color: #FFFFFF; margin-bottom: 4px;">
                ALSM TECHNOLOGY SOLUTIONS JSC
              </div>
              <div style="font-size: 11px; color: #8491A3; line-height: 1.6;">
                Keangnam Hanoi Landmark 72, Pham Hung Road, Nam Tu Liem, Hanoi<br />
                Hotline: (+84) 24 3795 8888 | Email: contracts@alsm.io<br />
                Portal: <a href="https://alsm.io" style="color: #FFFFFF; text-decoration: underline;">https://alsm.io</a>
              </div>
            </td>
            <td style="vertical-align: top; width: 40%; text-align: right;">
              <div style="font-size: 11px; font-weight: 600; color: #FFFFFF; margin-bottom: 4px;">
                Enterprise Legal &amp; Contracts
              </div>
              <div style="font-size: 10px; color: #8491A3; line-height: 1.5;">
                Dispatched automatically via ALSM Enterprise CRM.
              </div>
            </td>
          </tr>
        </table>

        <!-- Legal Disclaimer -->
        <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid #203954; font-size: 10px; color: #8491A3; line-height: 1.5;">
          CONFIDENTIALITY NOTICE: This transmission, including any attachments, contains confidential information intended solely for the designated recipient. Any unauthorized review, dissemination, copying, or reliance upon this information is strictly prohibited.
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
