import { renderEnterpriseCrmEmailHtml } from '../src/modules/crm/application/crm-email-template.helper';

describe('renderEnterpriseCrmEmailHtml', () => {
  it('should render a professional enterprise HTML email with Web 2 palette, clean tables, and no emojis', () => {
    const rawContent = `Dear Executive Team of Acme Corp,
Attn: John Doe

Thank you for choosing the ALSM Enterprise Modernization Solution.

COMMERCIAL AGREEMENT SUMMARY:
- Solution Package: ALSM Enterprise Legacy Modernization
- Project Scope: 1,000 screens + 1,000 programs
- Commercial Value: 10,000,000 VND

To enable our corporate legal department to finalize and dispatch the official Electronic Contract (E-Contract), please verify and provide the following legal entity credentials:

1. Registered Corporate Name: Acme Corp
2. Business Registration / Tax Identification Number: 
3. Official Headquarter Registered Address: 
4. Authorized Signatory Full Name: John Doe
5. Signatory Job Title / Position: Managing Director
6. Designated Email for Secure E-Signature Invitation: john@acme.com
7. Official Business Contact Phone: +84 987 654 321

Sincerely,
Enterprise Legal & Corporate Contracts Department
ALSM Technology Solutions JSC`;

    const html = renderEnterpriseCrmEmailHtml({
      subject: '[ALSM Enterprise] Request for Legal Entity Information',
      content: rawContent,
      companyName: 'Acme Corp',
      contactName: 'John Doe',
      referenceCode: 'LEI-TEST02',
    });

    expect(html).toContain('ALSM ENTERPRISE PLATFORM');
    expect(html).toContain('Ref: LEI-TEST02');
    expect(html).toContain('LEGAL ENTITY INTAKE DIRECTORY');
    expect(html).toContain('Registered Corporate Name');
    expect(html).toContain('Acme Corp');
    expect(html).toContain('[To be provided]');
    expect(html).toContain('CONFIDENTIALITY NOTICE');
    expect(html).toContain('#EEF1F6'); // Web 2 workspace background
    expect(html).toContain('#14263F'); // Web 2 corporate navy
    expect(html).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u); // No emojis
  });
});
