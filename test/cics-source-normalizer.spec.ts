import {
  normalizeBundle,
  normalizeCicsSource,
} from '../src/modules/conversions/infrastructure/cics-source-normalizer';

/** Builds fixed-format source: each entry is the text from column 8 onward. */
function cob(...areaB: string[]): string {
  return areaB.map((text) => `       ${text}`).join('\n');
}

function codeLines(source: string): string[] {
  return source.split('\n').filter((l) => l.length > 6 && l[6] !== '*');
}

function code(source: string): string {
  return codeLines(source)
    .map((l) => l.slice(7).trim())
    .filter(Boolean)
    .join(' ');
}

describe('normalizeCicsSource', () => {
  it('drops RESP/RESP2, keeps the original as a comment and puts END-EXEC on its own line', () => {
    const { source, changes } = normalizeCicsSource(
      cob(
        '    EXEC CICS RECEIVE',
        "              MAP('COSGN0A')",
        "              MAPSET('COSGN00')",
        '              RESP(WS-RESP-CD)',
        '              RESP2(WS-REAS-CD)',
        '    END-EXEC.',
      ),
    );

    expect(code(source)).toBe(
      "EXEC CICS RECEIVE MAP('COSGN0A') MAPSET('COSGN00') INTO(COSGN0AI) END-EXEC.",
    );
    const lines = codeLines(source);
    expect(lines.find((l) => /EXEC CICS/.test(l))).not.toMatch(/END-EXEC/);
    expect(lines[lines.length - 1].trim()).toBe('END-EXEC.');
    expect(source).toMatch(/^ {6}\* {4}EXEC CICS RECEIVE$/m);
    expect(changes.map((c) => c.detail)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^RESP\(WS-RESP-CD\) dropped/),
        expect.stringMatching(/^RESP2\(WS-REAS-CD\) dropped/),
        'implicit INTO(COSGN0AI) made explicit',
      ]),
    );
  });

  it('reorders options to the grammar order and reduces CURSOR(n) to CURSOR', () => {
    const { source, changes } = normalizeCicsSource(
      cob(
        "    EXEC CICS SEND MAP('M1') MAPSET('MS1')",
        '         ERASE CURSOR(WS-POS) FROM(M1O)',
        '    END-EXEC',
      ),
    );
    expect(code(source)).toBe(
      "EXEC CICS SEND MAP('M1') MAPSET('MS1') FROM(M1O) CURSOR ERASE END-EXEC",
    );
    expect(changes.map((c) => c.kind)).toEqual(
      expect.arrayContaining(['REORDERED', 'DROPPED_OPTION']),
    );
  });

  it('drops LENGTH OF / KEYLENGTH OF and RIDFLD on READ, mapping DATASET to FILE', () => {
    const { source } = normalizeCicsSource(
      cob(
        '    EXEC CICS READ',
        '         DATASET   (WS-USRSEC-FILE)',
        '         INTO      (SEC-USER-DATA)',
        '         LENGTH    (LENGTH OF SEC-USER-DATA)',
        '         RIDFLD    (WS-USER-ID)',
        '         KEYLENGTH (LENGTH OF WS-USER-ID)',
        '         RESP      (WS-RESP-CD)',
        '    END-EXEC.',
      ),
    );
    expect(code(source)).toBe('EXEC CICS READ FILE(WS-USRSEC-FILE) INTO(SEC-USER-DATA) END-EXEC.');
  });

  it('replaces unsupported commands with CONTINUE and keeps the sentence-ending period', () => {
    const { source, changes } = normalizeCicsSource(
      cob(
        '    IF WS-A = SPACES',
        '       EXEC CICS STARTBR',
        '            DATASET(WS-FILE) RIDFLD(WS-KEY)',
        '       END-EXEC',
        '    END-IF.',
        '    EXEC CICS ASKTIME ABSTIME(WS-T) END-EXEC.',
      ),
    );
    expect(code(source)).toBe('IF WS-A = SPACES CONTINUE END-IF. CONTINUE.');
    expect(changes.filter((c) => c.kind === 'REPLACED_WITH_CONTINUE')).toHaveLength(2);
  });

  it('hoists a subscripted PROGRAM argument into a working-storage temp', () => {
    const { source, hoists, needsSupportCopybook } = normalizeCicsSource(
      cob(
        'WORKING-STORAGE SECTION.',
        '01  WS-A PIC X.',
        'PROCEDURE DIVISION.',
        '    EXEC CICS XCTL',
        '         PROGRAM(CDEMO-MENU-OPT-PGMNAME(WS-OPTION))',
        '         COMMAREA(CARDDEMO-COMMAREA)',
        '    END-EXEC.',
      ),
    );
    expect(code(source)).toContain(
      'MOVE CDEMO-MENU-OPT-PGMNAME(WS-OPTION) TO ALSM-CICS-PROGRAM EXEC CICS XCTL PROGRAM(ALSM-CICS-PROGRAM) COMMAREA(CARDDEMO-COMMAREA) END-EXEC.',
    );
    expect(code(source)).toMatch(/^WORKING-STORAGE SECTION\. COPY ALSMCICS\./);
    expect(needsSupportCopybook).toBe(true);
    expect(hoists.get('ALSM-CICS-PROGRAM')).toBe('X(8)');
  });

  it('inlines DFHRESP(...) as the numeric EIBRESP code without shifting columns', () => {
    const line = '           WHEN DFHRESP(NOTFND)';
    const { source } = normalizeCicsSource(line);
    expect(source.trimEnd()).toBe('           WHEN 13');
    expect(source).toHaveLength(line.length);
  });

  it('removes separator commas outside literals only', () => {
    const { source } = normalizeCicsSource(
      cob("    STRING 'A, B', WS-X , WS-Y DELIMITED BY SIZE INTO WS-Z"),
    );
    expect(code(source)).toBe("STRING 'A, B'  WS-X   WS-Y DELIMITED BY SIZE INTO WS-Z");
  });

  it('removes the empty sentence after END-EXEC. and an empty INPUT-OUTPUT SECTION', () => {
    const { source } = normalizeCicsSource(
      cob(
        'ENVIRONMENT DIVISION.',
        'INPUT-OUTPUT SECTION.',
        '',
        'DATA DIVISION.',
        'PROCEDURE DIVISION.',
        '    EXEC CICS RETURN END-EXEC.',
        '    .',
      ),
    );
    expect(code(source)).toBe(
      'ENVIRONMENT DIVISION. DATA DIVISION. PROCEDURE DIVISION. EXEC CICS RETURN END-EXEC.',
    );
  });

  it('keeps every generated line inside column 72, leaving room on the EXEC CICS line', () => {
    const { source } = normalizeCicsSource(
      cob(
        '            EXEC CICS SEND MAP(WS-VERY-LONG-MAP-NAME) MAPSET(WS-VERY-LONG-MAPSET)',
        '                 FROM(WS-VERY-LONG-OUTPUT-AREA) LENGTH(WS-VERY-LONG-LENGTH-FIELD)',
        '                 ERASE FREEKB',
        '            END-EXEC.',
      ),
    );
    for (const line of codeLines(source)) {
      expect(line.length).toBeLessThanOrEqual(72);
      if (/EXEC CICS/.test(line)) expect(line.length).toBeLessThanOrEqual(67);
    }
  });

  it('leaves sources without EXEC CICS untouched', () => {
    const src = cob('PROCEDURE DIVISION.', '    MOVE 1 TO WS-A.', '    GOBACK.');
    const result = normalizeCicsSource(src);
    expect(result.source).toBe(src);
    expect(result.changes).toEqual([]);
  });
});

describe('normalizeBundle', () => {
  it('supplies DFHAID/DFHBMSCA stubs unless the bundle already has them', () => {
    const program = {
      name: 'P.cbl',
      content: cob(
        'WORKING-STORAGE SECTION.',
        'PROCEDURE DIVISION.',
        '    IF EIBCALEN = 0 GOBACK.',
      ),
    };
    const withoutUploads = normalizeBundle([program]);
    expect([...withoutUploads.stubs.keys()].sort()).toEqual([
      'ALSMCICS.cpy',
      'DFHAID.cpy',
      'DFHBMSCA.cpy',
    ]);
    expect(withoutUploads.stubs.get('ALSMCICS.cpy')).toMatch(/EIBCALEN\s+PIC S9\(4\) COMP/);

    const withUploads = normalizeBundle([
      program,
      { name: 'copy/DFHAID.cpy', content: '' },
      { name: 'DFHBMSCA.CPY', content: '' },
    ]);
    expect([...withUploads.stubs.keys()]).toEqual(['ALSMCICS.cpy']);
  });

  it('defines every DFHAID / DFHBMSCA symbol CardDemo references', () => {
    const { stubs } = normalizeBundle([]);
    const aid = stubs.get('DFHAID.cpy') ?? '';
    const bms = stubs.get('DFHBMSCA.cpy') ?? '';
    for (const sym of [
      'DFHENTER',
      'DFHCLEAR',
      'DFHPA1',
      'DFHPA2',
      'DFHPF3',
      'DFHPF12',
      'DFHPF24',
    ]) {
      expect(aid).toMatch(new RegExp(`\\b${sym}\\b`));
    }
    for (const sym of [
      'DFHRED',
      'DFHBMFSE',
      'DFHBMPRF',
      'DFHBMPRO',
      'DFHGREEN',
      'DFHNEUTR',
      'DFHBMDAR',
      'DFHBMASB',
      'DFHDFCOL',
      'DFHBMUNP',
      'DFHBMBRY',
      'DFHBMASF',
      'DFHBLUE',
    ]) {
      expect(bms).toMatch(new RegExp(`\\b${sym}\\b`));
    }
  });
});
