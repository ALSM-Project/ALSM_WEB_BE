import {
  analyzeBundle,
  buildCopybookIndex,
  extractCopyStatements,
  resolveProgram,
  type BundleFile,
} from '../src/modules/conversions/infrastructure/copybook-dependency-resolver.util';

function bundle(files: Record<string, string>): BundleFile[] {
  return Object.entries(files).map(([name, content]) => ({ name, content }));
}

describe('CopybookDependencyResolver', () => {
  // TC01: CUSTLDT.cbl -> CUSTOMER-REC.cpy => RESOLVED
  it('TC01 resolves a single direct copybook reference', () => {
    const files = bundle({
      'CUSTLDT.cbl': '       COPY CUSTOMER-REC.\n',
      'CUSTOMER-REC.cpy': '       01 CUSTOMER-REC.\n',
    });
    const results = analyzeBundle(files);
    const analysis = results.get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('READY_FOR_CONVERSION');
    expect(analysis.dependencies).toEqual([
      expect.objectContaining({ copyName: 'CUSTOMER-REC', status: 'RESOLVED', resolvedFile: 'CUSTOMER-REC.cpy' }),
    ]);
  });

  // TC02: missing copybook => MISSING
  it('TC02 reports MISSING when the referenced copybook does not exist in the bundle', () => {
    const files = bundle({ 'CUSTLDT.cbl': '       COPY CUSTOMER-REC.\n' });
    const analysis = resolveProgram('CUSTLDT.cbl', new Map(files.map((f) => [f.name, f.content])), buildCopybookIndex(files), new Map());
    expect(analysis.status).toBe('BLOCKED');
    expect(analysis.dependencies[0]).toMatchObject({
      copyName: 'CUSTOMER-REC',
      status: 'MISSING',
      message: "COPYBOOK 'CUSTOMER-REC' referenced by 'CUSTLDT.cbl' could not be found.",
    });
  });

  // TC03: two CUSTOMER.cpy candidates => AMBIGUOUS
  it('TC03 reports AMBIGUOUS when multiple files match the same normalized name', () => {
    const files: BundleFile[] = [
      { name: 'CUSTLDT.cbl', content: '       COPY CUSTOMER.\n' },
      { name: 'CUSTOMER.cpy', content: '' },
      { name: 'common/CUSTOMER.cpy', content: '' },
    ];
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('BLOCKED');
    expect(analysis.dependencies[0].status).toBe('AMBIGUOUS');
    expect(analysis.dependencies[0].candidates).toEqual(
      expect.arrayContaining(['CUSTOMER.cpy', 'common/CUSTOMER.cpy']),
    );
  });

  // TC04: nested copybook => RESOLVED
  it('TC04 resolves nested copybooks recursively', () => {
    const files = bundle({
      'CUSTLDT.cbl': '       COPY CUSTOMER-REC.\n',
      'CUSTOMER-REC.cpy': '       COPY COMMON-AREA.\n',
      'COMMON-AREA.cpy': '       COPY SYSTEM-CONSTANT.\n',
      'SYSTEM-CONSTANT.cpy': '       01 X PIC 9.\n',
    });
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('READY_FOR_CONVERSION');
    const level1 = analysis.dependencies[0];
    expect(level1.resolvedFile).toBe('CUSTOMER-REC.cpy');
    const level2 = level1.dependencies![0];
    expect(level2.resolvedFile).toBe('COMMON-AREA.cpy');
    const level3 = level2.dependencies![0];
    expect(level3.resolvedFile).toBe('SYSTEM-CONSTANT.cpy');
    expect(level3.status).toBe('RESOLVED');
  });

  // TC05: circular dependency => CIRCULAR_DEPENDENCY
  it('TC05 detects a circular copybook dependency instead of looping forever', () => {
    const files = bundle({
      'CUSTLDT.cbl': '       COPY A.\n',
      'A.cpy': '       COPY B.\n',
      'B.cpy': '       COPY A.\n',
    });
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('BLOCKED');
    const aEntry = analysis.dependencies[0];
    expect(aEntry.status).toBe('RESOLVED');
    const bEntry = aEntry.dependencies![0];
    expect(bEntry.status).toBe('RESOLVED');
    const circularEntry = bEntry.dependencies![0];
    expect(circularEntry.status).toBe('CIRCULAR_DEPENDENCY');
    expect(circularEntry.message).toContain('->');
  });

  // TC06: COPY ... REPLACING => RESOLVED
  it('TC06 handles COPY ... REPLACING clauses', () => {
    const files = bundle({
      'CUSTLDT.cbl': "       COPY CUSTOMER-REC REPLACING ==:PFX:== BY ==CUST==.\n",
      'CUSTOMER-REC.cpy': '       01 :PFX:-REC.\n',
    });
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('READY_FOR_CONVERSION');
    expect(analysis.dependencies[0]).toMatchObject({ copyName: 'CUSTOMER-REC', status: 'RESOLVED' });
  });

  // TC07: COPY statement split across multiple lines => RESOLVED
  it('TC07 handles a COPY statement split across multiple lines', () => {
    const files = bundle({
      'CUSTLDT.cbl': '       COPY\n           CUSTOMER-REC.\n',
      'CUSTOMER-REC.cpy': '',
    });
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('READY_FOR_CONVERSION');
    expect(analysis.dependencies[0].status).toBe('RESOLVED');
  });

  // TC08: case-insensitive matching => RESOLVED
  it('TC08 matches copy names and files case-insensitively', () => {
    const files = bundle({
      'CUSTLDT.cbl': '       copy customer-rec.\n',
      'CUSTOMER-REC.CPY': '',
    });
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('READY_FOR_CONVERSION');
    expect(analysis.dependencies[0].resolvedFile).toBe('CUSTOMER-REC.CPY');
  });

  // TC09: 100 .cbl + 500 .cpy => index built once, resolves in reasonable time
  it('TC09 indexes a large bundle once and resolves it quickly', () => {
    const files: BundleFile[] = [];
    for (let i = 0; i < 500; i++) {
      files.push({ name: `COPY${i}.cpy`, content: '       01 X PIC 9.\n' });
    }
    for (let i = 0; i < 100; i++) {
      // Each program copies 5 shared copybooks, so resolution must reuse cached results
      // rather than re-parsing the same copybook 100 times.
      const copies = Array.from({ length: 5 }, (_, j) => `       COPY COPY${j}.\n`).join('');
      files.push({ name: `PROG${i}.cbl`, content: copies });
    }

    const start = Date.now();
    const results = analyzeBundle(files);
    const elapsedMs = Date.now() - start;

    expect(results.size).toBe(100);
    for (let i = 0; i < 100; i++) {
      expect(results.get(`PROG${i}.cbl`)!.status).toBe('READY_FOR_CONVERSION');
    }
    expect(elapsedMs).toBeLessThan(2000);
  });

  // TC10: one .cbl with many .cpy, all must resolve correctly
  it('TC10 resolves every dependency correctly when a program copies several copybooks', () => {
    const files = bundle({
      'CUSTLDT.cbl': '       COPY CUSTOMER-REC.\n       COPY COMMON-AREA.\n       COPY ERROR-CODE.\n',
      'CUSTOMER-REC.cpy': '',
      'COMMON-AREA.cpy': '',
      'ERROR-CODE.cpy': '',
    });
    const analysis = analyzeBundle(files).get('CUSTLDT.cbl')!;
    expect(analysis.status).toBe('READY_FOR_CONVERSION');
    expect(analysis.dependencies).toHaveLength(3);
    expect(analysis.dependencies.every((d) => d.status === 'RESOLVED')).toBe(true);
  });

  describe('extractCopyStatements', () => {
    it('ignores COPY mentioned inside a fixed-format comment line', () => {
      const source = '      * this COPY CUSTOMER-REC is just documentation\n       COPY REAL-ONE.\n';
      const statements = extractCopyStatements(source);
      expect(statements).toHaveLength(1);
      expect(statements[0].copyName).toBe('REAL-ONE');
    });

    it('ignores COPY mentioned after an inline free-format comment', () => {
      const source = '       COPY REAL-ONE. *> COPY NOT-THIS\n';
      const statements = extractCopyStatements(source);
      expect(statements).toHaveLength(1);
      expect(statements[0].copyName).toBe('REAL-ONE');
    });

    it('finds multiple COPY statements in the same file with correct line numbers', () => {
      const source = '       COPY A.\n       COPY B.\n';
      const statements = extractCopyStatements(source);
      expect(statements).toEqual([
        { copyName: 'A', lineNumber: 1 },
        { copyName: 'B', lineNumber: 2 },
      ]);
    });
  });
});
