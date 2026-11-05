import { BmsRuleValidationService } from '../src/modules/validation/application/bms-rule-validation.service';
import { BmsValidationCategory } from '../src/modules/validation/domain/bms-validation-taxonomy';

describe('BmsRuleValidationService (Hybrid Step 1 & 2)', () => {
  let service: BmsRuleValidationService;

  beforeEach(() => {
    service = new BmsRuleValidationService();
  });

  const bmsMock = `
BNK1MAI DFHMSD TYPE=&SYSPARM,MODE=INOUT,LANG=COBOL
BNK1ME  DFHMDI SIZE=(24,80)
        DFHMDF POS=(1,1),LENGTH=7,INITIAL='BNK1MA '
CARDNUM DFHMDF POS=(8,45),LENGTH=16,ATTRB=(UNPROT,NUM),INITIAL=' '
PASSWD  DFHMDF POS=(9,45),LENGTH=8,ATTRB=(UNPROT,DRK),INITIAL=' '
PROTFLD DFHMDF POS=(10,45),LENGTH=20,ATTRB=(PROT,NORM),INITIAL='ReadOnly'
        DFHMDF POS=(24,1),LENGTH=25,INITIAL='F3=Exit   F12=Cancel'
        DFHMSD TYPE=FINAL
        END
  `;

  it('detects MISSING_FIELD when a required UNPROT BMS input is absent in React TSX', () => {
    const tsxWithoutCardNum = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="password" maxLength={8} />
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: tsxWithoutCardNum },
    );

    const missingField = result.findings.find(
      (f) => f.category === BmsValidationCategory.MISSING_FIELD && f.fieldName === 'CARDNUM',
    );
    expect(missingField).toBeDefined();
    expect(missingField?.severity).toBe('CRITICAL');
    expect(missingField?.sourceLocation.startLine).toBeGreaterThan(0);
  });

  it('detects ATTRIBUTE_MISMATCH when BMS has NUM but React lacks inputMode="numeric"', () => {
    const tsxMissingNumeric = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" maxLength={16} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="password" maxLength={8} />
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: tsxMissingNumeric },
    );

    const numMismatch = result.findings.find(
      (f) =>
        f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH &&
        f.fieldName === 'CARDNUM' &&
        f.explanation.includes('ATTRB=NUM'),
    );
    expect(numMismatch).toBeDefined();
    expect(numMismatch?.severity).toBe('HIGH');
  });

  it('detects ATTRIBUTE_MISMATCH when BMS has DRK but React input has type="text"', () => {
    const tsxExposingPassword = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" inputMode="numeric" maxLength={16} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="text" maxLength={8} />
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: tsxExposingPassword },
    );

    const drkMismatch = result.findings.find(
      (f) =>
        f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH &&
        f.fieldName === 'PASSWD' &&
        f.explanation.includes('DRK'),
    );
    expect(drkMismatch).toBeDefined();
    expect(drkMismatch?.severity).toBe('CRITICAL');
  });

  it('detects ATTRIBUTE_MISMATCH when LENGTH differs from maxLength', () => {
    const tsxWrongLength = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" inputMode="numeric" maxLength={10} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="password" maxLength={8} />
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: tsxWrongLength },
    );

    const lenMismatch = result.findings.find(
      (f) =>
        f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH &&
        f.fieldName === 'CARDNUM' &&
        f.explanation.includes('LENGTH='),
    );
    expect(lenMismatch).toBeDefined();
    expect(lenMismatch?.severity).toBe('MEDIUM');
  });

  it('detects LAYOUT_DISCREPANCY when gridRow differs from BMS POS row', () => {
    const tsxWrongPosition = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 12, gridColumn: '45 / span 16' }} id="cardnum" type="text" inputMode="numeric" maxLength={16} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="password" maxLength={8} />
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: tsxWrongPosition },
    );

    const layoutMismatch = result.findings.find(
      (f) => f.category === BmsValidationCategory.LAYOUT_DISCREPANCY && f.fieldName === 'CARDNUM',
    );
    expect(layoutMismatch).toBeDefined();
  });

  it('detects PF_KEY_MISMATCH when BMS function key legend is not wired in React', () => {
    const tsxMissingKeys = `
export function Screen() {
  return (
    <div>
      <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" inputMode="numeric" maxLength={16} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="password" maxLength={8} />
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: tsxMissingKeys },
    );

    const pfMismatch = result.findings.filter(
      (f) => f.category === BmsValidationCategory.PF_KEY_MISMATCH,
    );
    expect(pfMismatch.length).toBeGreaterThan(0);
    expect(pfMismatch.some((f) => f.fieldName.includes('F3'))).toBe(true);
  });

  it('yields zero findings when React TSX accurately matches BMS specifications', () => {
    const perfectTsx = `
export function Screen() {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'F3') { /* exit */ }
      if (e.key === 'F12') { /* cancel */ }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div>
      <span style={{ gridRow: 1, gridColumn: '1 / span 7' }}>BNK1MA</span>
      <input style={{ gridRow: 8, gridColumn: '45 / span 16' }} id="cardnum" type="text" inputMode="numeric" maxLength={16} />
      <input style={{ gridRow: 9, gridColumn: '45 / span 8' }} id="passwd" type="password" maxLength={8} />
      <span style={{ gridRow: 10, gridColumn: '45 / span 20' }}>ReadOnly</span>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'SCREEN.bms', content: bmsMock },
      { path: 'Screen.tsx', content: perfectTsx },
    );

    expect(result.findings).toHaveLength(0);
  });
});
