import { BmsRuleValidationService } from '../src/modules/validation/application/bms-rule-validation.service';
import { BmsValidationCategory } from '../src/modules/validation/domain/bms-validation-taxonomy';

describe('BmsRuleValidationService - DSPF Support (AS/400 DDS)', () => {
  let service: BmsRuleValidationService;

  beforeEach(() => {
    service = new BmsRuleValidationService();
  });

  const dspfMock = `
     A                                      DSPSIZ(24 80 *DS3)
     A          R GETNAME                   CF03(03) CF05(05)
     A                                  5  5'What is your name?'
     A            NAME          25A  I  5 25
     A                                      CHECK(LC)
     A                                  7  5'Account Code:'
     A            ACTCODE        6S  B  7 25
     A                                      EDTCDE(Y)
     A                                  9  5'Security PIN:'
     A            SECPIN         4A  B  9 25
     A                                      DSPATR(ND)
     A                                 23  2'F3=Exit  F5=Refresh'
  `;

  it('detects MISSING_FIELD when a required DSPF input field is absent in React TSX', () => {
    const tsxMissingName = `
export function GetNameScreen() {
  return (
    <div>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" inputMode="numeric" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="password" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: tsxMissingName },
    );

    const missingField = result.findings.find(
      (f) => f.category === BmsValidationCategory.MISSING_FIELD && f.fieldName === 'NAME',
    );
    expect(missingField).toBeDefined();
    expect(missingField?.severity).toBe('CRITICAL');
    expect(missingField?.sourceLocation.startLine).toBeGreaterThan(0);
  });

  it('detects ATTRIBUTE_MISMATCH when DSPF numeric field lacks inputMode="numeric" in React', () => {
    const tsxMissingNumeric = `
export function GetNameScreen() {
  return (
    <div>
      <GridItem col={25} row={5}>
        <Input maxLength={25} id="name" name="name" type="text" />
      </GridItem>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" type="text" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="password" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: tsxMissingNumeric },
    );

    const numMismatch = result.findings.find(
      (f) =>
        f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH &&
        f.fieldName === 'ACTCODE' &&
        f.explanation.includes('ATTRB=NUM'),
    );
    expect(numMismatch).toBeDefined();
    expect(numMismatch?.severity).toBe('HIGH');
  });

  it('detects ATTRIBUTE_MISMATCH when DSPF dark/ND field has type="text" in React', () => {
    const tsxExposingPin = `
export function GetNameScreen() {
  return (
    <div>
      <GridItem col={25} row={5}>
        <Input maxLength={25} id="name" name="name" type="text" />
      </GridItem>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" inputMode="numeric" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="text" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: tsxExposingPin },
    );

    const darkMismatch = result.findings.find(
      (f) =>
        f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH &&
        f.fieldName === 'SECPIN' &&
        f.explanation.includes('DRK'),
    );
    expect(darkMismatch).toBeDefined();
    expect(darkMismatch?.severity).toBe('CRITICAL');
  });

  it('detects ATTRIBUTE_MISMATCH when DSPF length differs from maxLength', () => {
    const tsxWrongLength = `
export function GetNameScreen() {
  return (
    <div>
      <GridItem col={25} row={5}>
        <Input maxLength={10} id="name" name="name" type="text" />
      </GridItem>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" inputMode="numeric" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="password" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: tsxWrongLength },
    );

    const lenMismatch = result.findings.find(
      (f) =>
        f.category === BmsValidationCategory.ATTRIBUTE_MISMATCH &&
        f.fieldName === 'NAME' &&
        f.explanation.includes('LENGTH='),
    );
    expect(lenMismatch).toBeDefined();
    expect(lenMismatch?.severity).toBe('MEDIUM');
  });

  it('detects LAYOUT_DISCREPANCY when DSPF row/col differs from React GridItem', () => {
    const tsxWrongPos = `
export function GetNameScreen() {
  return (
    <div>
      <GridItem col={20} row={8}>
        <Input maxLength={25} id="name" name="name" type="text" />
      </GridItem>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" inputMode="numeric" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="password" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: tsxWrongPos },
    );

    const layoutDiscrepancy = result.findings.find(
      (f) => f.category === BmsValidationCategory.LAYOUT_DISCREPANCY && f.fieldName === 'NAME',
    );
    expect(layoutDiscrepancy).toBeDefined();
    expect(layoutDiscrepancy?.severity).toBe('LOW');
  });

  it('detects PF_KEY_MISMATCH when DSPF CF keys are missing from React keydown listener', () => {
    const tsxMissingKeys = `
export function GetNameScreen() {
  return (
    <div>
      <GridItem col={25} row={5}>
        <Input maxLength={25} id="name" name="name" type="text" />
      </GridItem>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" inputMode="numeric" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="password" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: tsxMissingKeys },
    );

    const pfKeyFinding = result.findings.find(
      (f) => f.category === BmsValidationCategory.PF_KEY_MISMATCH && f.fieldName === 'PF_KEY_F3',
    );
    expect(pfKeyFinding).toBeDefined();
  });

  it('yields zero findings when React TSX accurately matches DSPF specifications', () => {
    const validTsx = `
export function GetNameScreen() {
  const FUNCTION_KEYS = [
    { key: 'F3', action: 'CF03' },
    { key: 'F5', action: 'CF05' },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const match = FUNCTION_KEYS.find((fk) => fk.key === e.key);
      if (match) submitAction(match.action);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div>
      <GridItem col={25} row={5}>
        <Input maxLength={25} id="name" name="name" type="text" />
      </GridItem>
      <GridItem col={25} row={7}>
        <Input maxLength={6} id="actcode" name="actcode" inputMode="numeric" />
      </GridItem>
      <GridItem col={25} row={9}>
        <Input maxLength={4} id="secpin" name="secpin" type="password" />
      </GridItem>
    </div>
  );
}
    `;

    const result = service.validate(
      { path: 'GETNAME.dspf', content: dspfMock },
      { path: 'GetNameScreen.tsx', content: validTsx },
    );

    expect(result.findings).toHaveLength(0);
  });
});
