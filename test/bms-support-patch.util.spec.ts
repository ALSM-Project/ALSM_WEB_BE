import { applyBmsSupportPatch } from '../src/modules/conversions/application/bms-support-patch.util';

// Shape copied from a real bms2react.py output (COACTVW), trimmed to the parts the patch touches.
const TSX = `import { useState } from 'react';

type formInput = {
  acctsid: string;
}

type formOutput = {
  acrdlim?: any;
  acsttus?: any;
  errmsg?: any;
}

export function COACTVW() {
  const [formData, setFormData] = useState<formInput>({
    acctsid: '',
  });
  const [receivedData, setReceivedData] = useState<formOutput>({
    acrdlim: '',
    acsttus: '',
  });
  const handleInputChange = (name: string, value: string) => setFormData((p) => ({ ...p, [name]: value }));
  return (
    <div>
      <input
        id="acctsid"
        name="acctsid"
        value={formData.acctsid ?? ''}
        onChange={(e) => handleInputChange('acctsid', e.target.value)}
      />
      <span>{receivedData.acsttus ?? ''}</span>
      <span>{formatPicOut(receivedData.acrdlim, 2, true)}</span>
      <span>{receivedData.errmsg ?? ''}</span>
    </div>
  );
}
`;

describe('applyBmsSupportPatch', () => {
  it('renames an input field everywhere bms2react.py writes it', () => {
    const { content, applied, skipped } = applyBmsSupportPatch(TSX, [
      { sourceField: 'ACCTSID', targetProperty: 'accountId', dataType: 'string' },
    ]);

    expect(skipped).toEqual([]);
    expect(applied).toEqual(['ACCTSID -> accountId: string']);
    expect(content).toContain('  accountId: string;');
    expect(content).toContain("    accountId: '',");
    expect(content).toContain('id="accountId"');
    expect(content).toContain('name="accountId"');
    expect(content).toContain('value={formData.accountId ?? \'\'}');
    expect(content).toContain("handleInputChange('accountId', e.target.value)");
    expect(content).not.toMatch(/\bacctsid\b/);
    expect(content.startsWith('// ALSM support patch applied to this generated screen:')).toBe(true);
  });

  it('renames and retypes an output field and applies a display transform', () => {
    const { content } = applyBmsSupportPatch(TSX, [
      { sourceField: 'ACSTTUS', targetProperty: 'accountStatus', dataType: 'string', transformRule: 'toUpperCase()' },
      { sourceField: 'ACRDLIM', targetProperty: 'creditLimit', dataType: 'BigDecimal' },
    ]);

    expect(content).toContain('  accountStatus?: string;');
    expect(content).toContain("{String(receivedData.accountStatus ?? '').toUpperCase()}");
    expect(content).toContain('  creditLimit?: string;');
    expect(content).toContain('formatPicOut(receivedData.creditLimit, 2, true)');
    // Untouched fields keep their generated names and types.
    expect(content).toContain('  errmsg?: any;');
  });

  it('reports rules it cannot apply instead of dropping them', () => {
    const { content, applied, skipped } = applyBmsSupportPatch(TSX, [
      { sourceField: 'NOSUCH', targetProperty: 'x', dataType: 'string' },
      { sourceField: 'ACSTTUS', targetProperty: 'errmsg', dataType: 'string' },
      { sourceField: 'ACRDLIM', targetProperty: 'creditLimit', dataType: 'number', transformRule: 'toCurrency' },
    ]);

    expect(skipped).toEqual([
      { sourceField: 'NOSUCH', reason: 'The field does not exist on this screen' },
      { sourceField: 'ACSTTUS', reason: '"errmsg" is already the name of another field on this screen' },
      {
        sourceField: 'ACRDLIM',
        reason: expect.stringContaining('Transform "toCurrency" is not supported'),
      },
    ]);
    expect(applied).toEqual(['ACRDLIM -> creditLimit: number']);
    expect(content).toContain('  creditLimit?: number;');
    expect(content).toContain('{receivedData.acsttus ?? \'\'}');
  });

  it('starts a non-text output field as undefined instead of an empty string', () => {
    const { content } = applyBmsSupportPatch(TSX, [
      { sourceField: 'ACRDLIM', targetProperty: 'creditLimit', dataType: 'number' },
    ]);
    expect(content).toContain('  creditLimit?: number;');
    expect(content).toContain('    creditLimit: undefined,');
    // The input initializer of another field is untouched.
    expect(content).toContain("    acctsid: '',");
  });

  it('does not claim a transform on a field the screen never displays as text', () => {
    const { applied, skipped } = applyBmsSupportPatch(TSX, [
      { sourceField: 'ACCTSID', targetProperty: 'accountId', dataType: 'string', transformRule: 'trim' },
    ]);
    expect(applied).toEqual(['ACCTSID -> accountId: string']);
    expect(skipped[0].reason).toMatch(/applies only to fields the screen displays as plain text/);
  });

  it('leaves the file unchanged when nothing applies', () => {
    const { content } = applyBmsSupportPatch(TSX, [
      { sourceField: 'NOSUCH', targetProperty: 'x', dataType: 'string' },
    ]);
    expect(content).toBe(TSX);
  });
});
