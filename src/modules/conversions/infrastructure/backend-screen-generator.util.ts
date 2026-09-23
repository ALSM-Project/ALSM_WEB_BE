export interface ScreenField {
  name: string;
  label: string;
  defaultValue: string;
  type?: 'text' | 'select' | 'password' | 'number';
  options?: string[];
  fullWidth?: boolean;
}

export interface GeneratedScreenBundle {
  title: string;
  subtitle: string;
  fields: ScreenField[];
  files: { relativePath: string; language: string; content: string }[];
  linesOfCode: number;
}

/**
 * Deterministically generates screen fields, TSX code, and DTOs based on the screen name.
 */
export function generateBackendScreenBundle(screenName: string): GeneratedScreenBundle {
  const cleanName = screenName.replace(/\.(bms|dspf|cob|cbl|dds)$/i, '');
  const pascalName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1).replace(/[^A-Za-z0-9]/g, '');
  const upper = cleanName.toUpperCase();

  let fields: ScreenField[] = [];
  let title = `${upper} Modernized Screen`;
  let subtitle = `CICS Legacy Screen (${screenName} → React Form)`;

  if (upper.includes('COUSR01') || upper.includes('USER01')) {
    title = 'CICS User Profile Inquiry & Create';
    subtitle = 'User Profile Management (BMS Map → React Form)';
    fields = [
      { name: 'USERID', label: 'User Identifier (USERID)', defaultValue: 'USR-88401' },
      { name: 'FNAME', label: 'First Name (FNAME)', defaultValue: 'ALEXANDER' },
      { name: 'LNAME', label: 'Last Name (LNAME)', defaultValue: 'HAMILTON' },
      { name: 'EMAIL', label: 'Email Address (EMAIL)', defaultValue: 'a.hamilton@financial.org', fullWidth: true },
      { name: 'ROLE', label: 'System Role (ROLE)', defaultValue: 'ADMINISTRATOR', type: 'select', options: ['ADMINISTRATOR', 'OPERATOR', 'AUDITOR', 'GUEST'] },
      { name: 'DEPT', label: 'Department Code (DEPT)', defaultValue: 'TREASURY' },
    ];
  } else if (upper.includes('COACT') || upper.includes('ACTUP') || upper.includes('COUSR02') || upper.includes('ACCT')) {
    title = 'CardDemo - Account Update Screen';
    subtitle = 'Card Account & Customer Management (COACTUP.bms → React Form)';
    fields = [
      { name: 'ACCTSID', label: 'Account Number (ACCTSID)', defaultValue: '00000000001' },
      { name: 'ACSTTUS', label: 'Active Status (ACSTTUS)', defaultValue: 'Y', type: 'select', options: ['Y', 'N'] },
      { name: 'ACRDLIM', label: 'Credit Limit (ACRDLIM)', defaultValue: '$50,000.00' },
      { name: 'ACSHLIM', label: 'Cash Credit Limit (ACSHLIM)', defaultValue: '$10,000.00' },
      { name: 'ACURBAL', label: 'Current Balance (ACURBAL)', defaultValue: '$1,250.00' },
      { name: 'ACSTNUM', label: 'Customer ID (ACSTNUM)', defaultValue: '000000089' },
      { name: 'ACSFNAM', label: 'First Name (ACSFNAM)', defaultValue: 'JANE' },
      { name: 'ACSMNAM', label: 'Middle Name (ACSMNAM)', defaultValue: 'MARIA' },
      { name: 'ACSLNAM', label: 'Last Name (ACSLNAM)', defaultValue: 'DOE' },
      { name: 'ACSADL1', label: 'Address Line 1 (ACSADL1)', defaultValue: '123 BROADWAY AVE', fullWidth: true },
      { name: 'ACSCITY', label: 'City (ACSCITY)', defaultValue: 'NEW YORK' },
      { name: 'ACSSTTE', label: 'State (ACSSTTE)', defaultValue: 'NY' },
      { name: 'ACSZIPC', label: 'Zip Code (ACSZIPC)', defaultValue: '10001' },
      { name: 'ACSPFLG', label: 'Primary Card Holder (ACSPFLG)', defaultValue: 'Y', type: 'select', options: ['Y', 'N'] },
    ];
  } else if (upper.includes('COUSR03') || upper.includes('DELUSR') || upper.includes('DELETEUSER')) {
    title = 'CardDemo - Delete User';
    subtitle = 'Delete User Management (COUSR03.bms → React Form)';
    fields = [
      { name: 'USRIDIN', label: 'Enter User ID (USRIDIN)', defaultValue: 'USR-00928' },
      { name: 'FNAME', label: 'First Name (FNAME)', defaultValue: 'ALEXANDER' },
      { name: 'LNAME', label: 'Last Name (LNAME)', defaultValue: 'HAMILTON' },
      { name: 'USRTYPE', label: 'User Type (USRTYPE)', defaultValue: 'U (User)', type: 'select', options: ['A (Admin)', 'U (User)'] },
      { name: 'ERRMSG', label: 'System Message (ERRMSG)', defaultValue: 'Ready for user deletion. Press Delete to confirm.', fullWidth: true },
    ];
  } else if (upper.includes('COCRD') || upper.includes('CARD')) {
    title = 'CardDemo - Credit Card Details & Limit';
    subtitle = 'Credit Card Management (COCRD01.bms → React Form)';
    fields = [
      { name: 'CARDNO', label: 'Card Number (CARDNO)', defaultValue: '4532-8819-2049-8891' },
      { name: 'CRDNAME', label: 'Cardholder Name (CRDNAME)', defaultValue: 'HOANG ENTERPRISE CORP', fullWidth: true },
      { name: 'EXPDATE', label: 'Expiration Date (EXPDATE)', defaultValue: '12/28' },
      { name: 'CARDTYPE', label: 'Card Type (CARDTYPE)', defaultValue: 'VISA GOLD', type: 'select', options: ['VISA GOLD', 'MASTERCARD PLATINUM', 'AMEX CORPORATE'] },
      { name: 'CVV', label: 'Security Code (CVV)', defaultValue: '***', type: 'password' },
      { name: 'DAYLIMIT', label: 'Daily ATM Limit (DAYLIMIT)', defaultValue: '$10,000.00' },
      { name: 'CARDSTAT', label: 'Card Status (CARDSTAT)', defaultValue: 'ISSUED', type: 'select', options: ['ISSUED', 'SUSPENDED', 'CANCELLED'] },
    ];
  } else if (upper.includes('COTRN') || upper.includes('TRN') || upper.includes('PAY')) {
    title = 'CICS Financial Transaction Entry';
    subtitle = 'Transaction Post & Clearance (BMS Map → React Form)';
    fields = [
      { name: 'TRNID', label: 'Transaction Reference (TRNID)', defaultValue: 'TXN-90214819' },
      { name: 'ACCTNO', label: 'Source Account (ACCTNO)', defaultValue: '4000-1234-5678-9010' },
      { name: 'TRNAMT', label: 'Transaction Amount (TRNAMT)', defaultValue: '$1,250.00' },
      { name: 'TRNDATE', label: 'Posting Date (TRNDATE)', defaultValue: '2026-09-22 14:30:00' },
      { name: 'MERCHANT', label: 'Merchant Identifier (MERCHANT)', defaultValue: 'GLOBAL SUPPLIES INC', fullWidth: true },
      { name: 'TRNTYPE', label: 'Transaction Type (TRNTYPE)', defaultValue: 'DEBIT', type: 'select', options: ['DEBIT', 'CREDIT', 'REFUND', 'ADJUSTMENT'] },
    ];
  } else {
    let hash = 0;
    for (let i = 0; i < upper.length; i++) hash = (hash << 5) - hash + upper.charCodeAt(i);
    const fieldCount = 4 + (Math.abs(hash) % 4);

    const sampleFields: ScreenField[] = [
      { name: 'REFCODE', label: `${upper} Reference Code (REFCODE)`, defaultValue: `REF-${Math.abs(hash % 90000) + 10000}` },
      { name: 'STATUS', label: 'Process Status (STATUS)', defaultValue: 'PENDING', type: 'select', options: ['PENDING', 'APPROVED', 'REJECTED'] },
      { name: 'SYSID', label: 'System Source ID (SYSID)', defaultValue: 'SYS-MAIN-01' },
      { name: 'OPERATOR', label: 'Operator ID (OPERATOR)', defaultValue: 'OPR-402' },
      { name: 'VALDATE', label: 'Effective Date (VALDATE)', defaultValue: '2026-10-01' },
      { name: 'REMARKS', label: 'System Audit Notes (REMARKS)', defaultValue: `Converted from ${screenName} BMS legacy map`, fullWidth: true },
      { name: 'CTRLNUM', label: 'Control Sequence (CTRLNUM)', defaultValue: 'CTRL-0982' },
    ];

    fields = sampleFields.slice(0, fieldCount);
    title = `${upper} Modernized Screen`;
    subtitle = `Legacy BMS/DSPF Screen (${screenName} → React Form)`;
  }

  const fieldStateProps = fields.map((f) => `  ${f.name.toLowerCase()}: string;`).join('\n');
  const fieldInitState = fields.map((f) => `    ${f.name.toLowerCase()}: '${f.defaultValue}',`).join('\n');

  const tsxContent = `import React, { useState } from 'react';

export interface ${pascalName}FormData {
${fieldStateProps}
}

/**
 * Modernized React Component for ${screenName}
 * ${subtitle}
 * Generated deterministically by ALSM Modernization Engine
 */
export const ${pascalName}Screen: React.FC = () => {
  const [formData, setFormData] = useState<${pascalName}FormData>({
${fieldInitState}
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Submitted ${screenName} Modernized Form:', formData);
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 bg-white rounded-2xl border border-slate-200 space-y-4">
      <h2 className="text-lg font-bold text-slate-900">${title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
${fields
  .map(
    (f) => `        <div${f.fullWidth ? ' className="md:col-span-2"' : ''}>
          <label className="block text-slate-700 font-semibold mb-1">${f.label}</label>
          ${
            f.type === 'select'
              ? `<select
            value={formData.${f.name.toLowerCase()}}
            onChange={(e) => setFormData({ ...formData, ${f.name.toLowerCase()}: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-slate-900"
          >
${(f.options || []).map((opt) => `            <option value="${opt}">${opt}</option>`).join('\n')}
          </select>`
              : `<input
            type="${f.type || 'text'}"
            value={formData.${f.name.toLowerCase()}}
            onChange={(e) => setFormData({ ...formData, ${f.name.toLowerCase()}: e.target.value })}
            className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 font-mono text-slate-900"
          />`
          }
        </div>`,
  )
  .join('\n')}
      </div>
      <div className="flex space-x-3 pt-2">
        <button type="submit" className="px-4 py-2 bg-[#0652CC] text-white text-xs font-bold rounded-lg shadow-xs">
          Submit Form
        </button>
        <button type="button" className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg">
          Cancel
        </button>
      </div>
    </form>
  );
};

export default ${pascalName}Screen;`;

  const dtoProps = fields.map((f) => `  ${f.name}: string;`).join('\n');
  const dtoContent = `/**
 * Data Transfer Object for ${screenName}
 * Generated deterministically by ALSM Modernization Engine
 */
export interface ${pascalName}Dto {
${dtoProps}
  LAST_UPDATED: string;
}`;

  const files = [
    {
      relativePath: `src/components/${pascalName}Screen.tsx`,
      language: 'typescript',
      content: tsxContent,
    },
    {
      relativePath: `src/types/${cleanName}.dto.ts`,
      language: 'typescript',
      content: dtoContent,
    },
  ];

  const linesOfCode = files.reduce((sum, f) => sum + f.content.split('\n').length, 0);

  return {
    title,
    subtitle,
    fields,
    files,
    linesOfCode,
  };
}
