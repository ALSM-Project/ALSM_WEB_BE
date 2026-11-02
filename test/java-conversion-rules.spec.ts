import { RuleValidatorService } from '../src/modules/conversions/application/rule-validator.service';
import {
  checkDataTypes,
  checkNamingConventions,
  checkUnsupportedConstructs,
  validateGeneratedJava,
} from '../src/modules/conversions/infrastructure/java-conversion-rules.util';
import { ConversionJobStatus } from '../src/modules/conversions/domain/conversion-job.types';
import { FindingSeverity } from '../src/modules/conversions/domain/validation.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';

const cleanTasklet = {
  relativePath: 'cobolprogramclasses/model01/Model01Tasklet.java',
  content: `public class Model01Tasklet {
  public void mainControl() {}
  public void caseOne() {}
}`,
};

describe('COBOL to Java rules', () => {
  it('flags COMP-1/COMP-2 as floating point and wide COMP items as overflow risks, but not small COMP items', () => {
    const findings = checkDataTypes([
      {
        relativePath: 'Model.java',
        content: [
          'small = recordSmall.subSequence(0,4).withFormat("S9(9)").withOption("COMP");',
          'wide = recordWide.subSequence(0,8).withFormat("S9(12)").withOption("COMP");',
          'ratio = recordRatio.subSequence(0,4).withFormat("S9(4)").withOption("COMP-2");',
        ].join('\n'),
      },
    ]);
    expect(findings.map((f) => [f.issueType, f.severity])).toEqual([
      ['COMP_OVERFLOW_RISK', FindingSeverity.HIGH],
      ['COMP_FLOATING_POINT', FindingSeverity.MEDIUM],
    ]);
    expect(findings[0].sourceLocation).toContain('wide');
  });

  it('accepts CamelCase names and reports underscores in classes and methods', () => {
    expect(checkNamingConventions([cleanTasklet])).toEqual([]);
    const [finding] = checkNamingConventions([
      {
        relativePath: 'Model.java',
        content: 'public class Model { public class TimeArea_1 {} public void case_0001() {} }',
      },
    ]);
    expect(finding.issueType).toBe('NAMING_CONVENTION');
    expect(finding.severity).toBe(FindingSeverity.LOW);
    expect(finding.targetLocation).toContain('class TimeArea_1');
    expect(finding.targetLocation).toContain('case_0001()');
  });

  it('reports ALTER, GO TO DEPENDING ON and EXEC SQL without a repository', () => {
    const findings = checkUnsupportedConstructs([
      {
        relativePath: 'Prog.java',
        content:
          '//* ALTER PARA-A TO PROCEED TO PARA-B\n//* GO TO P1 P2 DEPENDING ON IDX\n//* EXEC SQL SELECT 1 END-EXEC',
      },
    ]);
    expect(findings.map((f) => f.sourceLocation.split(' in ')[0])).toEqual([
      'ALTER',
      'GO TO ... DEPENDING ON',
      'EXEC SQL',
    ]);
    expect(
      checkUnsupportedConstructs([
        { relativePath: 'Prog.java', content: '// EXEC SQL\nprivate AccountRepository accountRepository;' },
      ]),
    ).toEqual([]);
  });

  it('returns no findings for clean generated Java', () => {
    expect(validateGeneratedJava([cleanTasklet])).toEqual([]);
  });
});

describe('RuleValidatorService for a COBOL to Java job', () => {
  const validation = {
    createRun: jest.fn(async (run: Record<string, unknown>) => ({ id: 'run-1', ...run })),
    createFindings: jest.fn(async (rows: Record<string, unknown>[]) =>
      rows.map((row, i) => ({ id: `f-${i}`, ...row })),
    ),
  };
  const mappings = { findByScreen: jest.fn() };
  const storage = { readFiles: jest.fn() };
  const service = new RuleValidatorService(validation as never, mappings as never, storage as never);
  const job = {
    id: 'job-1',
    projectId: 'p1',
    screenId: 's1',
    status: ConversionJobStatus.COMPLETED,
    conversionType: ConversionType.COBOL_TO_JAVA,
    toolVersion: 'tool2java',
    resultReference: 'results/p1/job-1/x',
  };

  beforeEach(() => jest.clearAllMocks());

  it('never runs the BMS DatePicker rules or invents the EXP_DATE finding', async () => {
    storage.readFiles.mockResolvedValue([
      { relativePath: cleanTasklet.relativePath, content: Buffer.from(cleanTasklet.content) },
    ]);
    const { run, findings } = await service.runValidation(job as never, 'org-1');

    expect(mappings.findByScreen).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
    expect(run).toMatchObject({ status: 'COMPLETED', totalFindings: 0, openCount: 0 });
    expect(JSON.stringify(validation.createFindings.mock.calls)).not.toContain('EXP_DATE');
  });

  it('reports Java findings for a real problem', async () => {
    storage.readFiles.mockResolvedValue([
      { relativePath: 'Prog.java', content: Buffer.from('public class Prog { public void do_it() {} }') },
    ]);
    const { findings } = await service.runValidation(job as never, 'org-1');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ issueType: 'NAMING_CONVENTION', validatorType: 'RULE_VALIDATOR' });
  });

  it('says so with an INFO finding when no Java has been generated yet', async () => {
    const { findings } = await service.runValidation(
      { ...job, resultReference: undefined } as never,
      'org-1',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ issueType: 'NO_GENERATED_CODE', severity: FindingSeverity.INFO });
  });
});

describe('RuleValidatorService for a BMS job', () => {
  it('no longer invents a finding when nothing is wrong', async () => {
    const validation = {
      createRun: jest.fn(async (run: Record<string, unknown>) => ({ id: 'run-1', ...run })),
      createFindings: jest.fn(async (rows: Record<string, unknown>[]) => rows),
    };
    const mappings = { findByScreen: jest.fn().mockResolvedValue({ mappings: [] }) };
    const storage = { readFiles: jest.fn().mockResolvedValue([]) };
    const service = new RuleValidatorService(validation as never, mappings as never, storage as never);
    const { findings } = await service.runValidation(
      {
        id: 'j',
        projectId: 'p',
        screenId: 's',
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
        toolVersion: 'convert2fe',
      } as never,
      'org-1',
    );
    expect(findings).toEqual([]);
  });
});
