import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { CobolJavaConversionAdapter } from '../src/modules/conversions/infrastructure/cobol-java-conversion.adapter';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ErrorLogRepository } from '../src/modules/conversions/domain/error-log.types';
import { CopybookDependencyBlockedError } from '../src/modules/conversions/domain/copybook-dependency-blocked.error';
import { ScreenRepository } from '../src/modules/screens/domain/screen.types';
import { StoragePort } from '../src/shared/storage/storage.port';
import * as toolRunner from '../src/modules/conversions/infrastructure/conversion-tool-runner.util';

jest.mock('../src/modules/conversions/infrastructure/conversion-tool-runner.util', () => ({
  ...jest.requireActual('../src/modules/conversions/infrastructure/conversion-tool-runner.util'),
  runConversionTool: jest.fn(),
}));

describe('CobolJavaConversionAdapter', () => {
  let sourceDir: string;
  const configValues: Record<string, unknown> = {
    TOOL2JAVA_JAR_PATH: '/tools/akaBatch-1.0.jar',
    JAVA_EXECUTABLE: 'java',
    CONVERSION_TOOL_TIMEOUT_MS: 5000,
  };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const storage: Partial<StoragePort> = {
    resolvePath: jest.fn(),
    writeFiles: jest.fn(),
  };
  const errorLogs = { create: jest.fn() };
  const screens: Partial<ScreenRepository> = { findById: jest.fn() };

  const baseInput = {
    conversionJobId: 'job-2',
    organizationId: 'org-1',
    projectId: 'p1',
    inputReference: 'src-ref',
    conversionType: ConversionType.COBOL_TO_JAVA,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sourceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alsm-test-cobol-src-'));
    (storage.resolvePath as jest.Mock).mockReturnValue(sourceDir);
    (storage.writeFiles as jest.Mock).mockResolvedValue('results/p1/job-2/uuid');
    (screens.findById as jest.Mock).mockResolvedValue(null);
  });

  afterEach(async () => {
    await fs.promises.rm(sourceDir, { recursive: true, force: true });
  });

  function buildAdapter(): CobolJavaConversionAdapter {
    return new CobolJavaConversionAdapter(
      config as unknown as ConfigService,
      storage as StoragePort,
      errorLogs as unknown as ErrorLogRepository,
      screens as ScreenRepository,
    );
  }

  function argAfter(args: string[], flag: string): string {
    return args[args.indexOf(flag) + 1];
  }

  /** What the tool writes for one converted program in project mode. */
  async function writeJob(args: string[], program: string, className: string): Promise<void> {
    const dir = path.join(argAfter(args, '-odir'), 'src', 'main', 'java', 'jp', 'co', 'alsm', 'batch', 'jobs', program);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, `${className}.java`),
      `package jp.co.alsm.batch.jobs.${program};\n\npublic class ${className} {}\n`,
    );
  }

  async function writeReport(args: string[], report: Record<string, unknown>): Promise<void> {
    await fs.promises.writeFile(
      path.join(argAfter(args, '-odir'), 'conversion_report.json'),
      JSON.stringify(report),
    );
  }

  it('converts the bundle in project mode and stores the converted jobs with the report', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'BUBBLESORT.cob'), 'COBOL SOURCE');
    let seenArgs: string[] = [];
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[], options: { cwd: string }) => {
        seenArgs = args;
        await writeJob(args, 'bubblesort', 'BubblesortTasklet');
        // The runtime and launcher the tool writes next to the jobs are not stored: the export
        // adds its own.
        const runtimeDir = path.join(argAfter(args, '-odir'), 'src', 'main', 'java', 'jp', 'co', 'alsm', 'common');
        await fs.promises.mkdir(runtimeDir, { recursive: true });
        await fs.promises.writeFile(path.join(runtimeDir, 'Record.java'), 'public class Record {}');
        await writeReport(args, { converted: 1, failed: 0, failures: [] });
        expect(options.cwd).not.toBe(sourceDir);
        return { code: 0, stdout: 'Converted 1 of 1 program(s).', stderr: '', timedOut: false };
      },
    );

    const output = await buildAdapter().execute(baseInput);

    expect(output).toEqual({ resultReference: 'results/p1/job-2/uuid', toolVersion: 'tool2java' });
    expect(seenArgs.slice(0, 2)).toEqual(['-jar', '/tools/akaBatch-1.0.jar']);
    expect(argAfter(seenArgs, '-project')).toBeTruthy();
    expect(argAfter(seenArgs, '-basePackage')).toBe('jp.co.alsm.batch');
    expect(seenArgs).toEqual(expect.arrayContaining(['-odir', '-scaffold', '-noverify']));
    expect(seenArgs).not.toContain('-dld');
    const stored = (storage.writeFiles as jest.Mock).mock.calls[0][1] as { relativePath: string }[];
    expect(stored.map((f) => f.relativePath).sort()).toEqual([
      'conversion_report.json',
      'jp/co/alsm/batch/jobs/bubblesort/BubblesortTasklet.java',
    ]);
    expect(errorLogs.create).not.toHaveBeenCalled();
  });

  it('passes -encoding when configured and runs the build check when it is switched on', async () => {
    configValues.CONVERSION_SOURCE_ENCODING = 'MS932';
    configValues.CONVERSION_VERIFY_BUILD = 'true';
    let seenArgs: string[] = [];
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(async (_exe: string, args: string[]) => {
      seenArgs = args;
      await writeJob(args, 'ok', 'OkTasklet');
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    });
    try {
      await buildAdapter().execute(baseInput);
    } finally {
      delete configValues.CONVERSION_SOURCE_ENCODING;
      delete configValues.CONVERSION_VERIFY_BUILD;
    }
    expect(argAfter(seenArgs, '-encoding')).toBe('MS932');
    expect(seenArgs).not.toContain('-noverify');
  });

  it("copies the tool's Config.properties into the job working directory before running it", async () => {
    const toolDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alsm-test-tool-'));
    await fs.promises.mkdir(path.join(toolDir, 'target'));
    await fs.promises.writeFile(path.join(toolDir, 'Config.properties'), 'dataPackage = test.package');
    const previousJar = configValues.TOOL2JAVA_JAR_PATH;
    configValues.TOOL2JAVA_JAR_PATH = path.join(toolDir, 'target', 'akaBatch-1.0.jar');
    let seenConfig: string | undefined;
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[], options: { cwd: string }) => {
        seenConfig = await fs.promises.readFile(path.join(options.cwd, 'Config.properties'), 'utf8');
        await writeJob(args, 'result', 'ResultTasklet');
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
    );
    try {
      await buildAdapter().execute(baseInput);
    } finally {
      configValues.TOOL2JAVA_JAR_PATH = previousJar;
      await fs.promises.rm(toolDir, { recursive: true, force: true });
    }
    expect(seenConfig).toBe('dataPackage = test.package');
    // The copied settings file is never mistaken for generated output.
    expect(storage.writeFiles).toHaveBeenCalledWith(
      'results/p1/job-2',
      expect.not.arrayContaining([expect.objectContaining({ relativePath: 'Config.properties' })]),
    );
  });

  it('isolates overlapping attempts of the same job in distinct working directories', async () => {
    const workingDirectories: string[] = [];
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[], options: { cwd: string }) => {
        workingDirectories.push(options.cwd);
        await writeJob(args, 'result', 'ResultTasklet');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
    );
    await Promise.all([buildAdapter().execute(baseInput), buildAdapter().execute(baseInput)]);
    expect(new Set(workingDirectories).size).toBe(2);
    expect(storage.writeFiles).toHaveBeenCalledTimes(2);
  });

  it("translates only the screen's own program, but still indexes the whole bundle", async () => {
    (screens.findById as jest.Mock).mockResolvedValue({ id: 'scr-1', name: 'CBTRN02C.cbl' });
    await fs.promises.writeFile(path.join(sourceDir, 'CBTRN02C.cbl'), 'COBOL');
    let seenArgs: string[] = [];
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        seenArgs = args;
        await writeJob(args, 'cbtrn02c', 'Cbtrn02cTasklet');
        await writeReport(args, { converted: 1, failed: 0, failures: [] });
        return { code: 0, stdout: 'Converted 1 of 1 program(s).', stderr: '', timedOut: false };
      },
    );

    await buildAdapter().execute({ ...baseInput, screenId: 'scr-1' });

    expect(argAfter(seenArgs, '-only')).toBe('CBTRN02C.cbl');
    expect(argAfter(seenArgs, '-project')).toBeTruthy();
  });

  it('fails the job with the reason when its own program cannot be converted', async () => {
    (screens.findById as jest.Mock).mockResolvedValue({ id: 'scr-1', name: 'COACTVWC.cbl' });
    await fs.promises.writeFile(path.join(sourceDir, 'COACTVWC.cbl'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeReport(args, {
          converted: 0,
          failed: 1,
          failures: [{ programId: 'COACTVWC', file: 'COACTVWC.cbl', line: 425, reason: 'Duplcate Paragraph: 0000-MAIN-EXIT' }],
        });
        return { code: 0, stdout: 'Converted 0 of 1 program(s).', stderr: '', timedOut: false };
      },
    );

    await expect(buildAdapter().execute({ ...baseInput, screenId: 'scr-1' })).rejects.toThrow(
      /COACTVWC: Duplcate Paragraph: 0000-MAIN-EXIT/,
    );
  });

  it('converts the whole bundle when the job is not tied to a screen', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL');
    let seenArgs: string[] = [];
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        seenArgs = args;
        await writeJob(args, 'ok', 'OkTasklet');
        return { code: 0, stdout: 'Done in 0s.', stderr: '', timedOut: false };
      },
    );
    await buildAdapter().execute(baseInput);
    expect(seenArgs).not.toContain('-only');
  });

  it('records an ErrorLogRecord for each program the report lists as failed', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL');
    await fs.promises.writeFile(path.join(sourceDir, 'BROKEN.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeJob(args, 'ok', 'OkTasklet');
        await writeJob(args, 'broken', 'BrokenTasklet');
        await writeReport(args, {
          converted: 1,
          failed: 1,
          failures: [
            {
              programId: 'BROKEN',
              file: 'cbl/BROKEN.cob',
              line: 4,
              reason: 'com.res.cobol.parser.ParseException: Encountered "x" at line 4, column 8.',
            },
          ],
        });
        return { code: 0, stdout: 'Converted 1 of 2 program(s).', stderr: '', timedOut: false };
      },
    );

    await buildAdapter().execute(baseInput);

    expect(errorLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'COBOL_TRANSLATION_FAILED',
        offendingCode: 'BROKEN.cob',
        lineNumber: 4,
        suggestedPatch: expect.objectContaining({ offendingLine: 'N/A', suggestedLine: 'N/A' }),
      }),
    );
  });

  it('falls back to the console log for parse errors when the tool writes no report', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeJob(args, 'ok', 'OkTasklet');
        return {
          code: 0,
          stdout: [
            'Parsing Cobol started for: BROKEN.cob',
            'com.res.cobol.parser.ParseException: Encountered "x" at line 4, column 8.',
          ].join('\n'),
          stderr: '',
          timedOut: false,
        };
      },
    );

    await buildAdapter().execute(baseInput);

    expect(errorLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({ offendingCode: 'BROKEN.cob', lineNumber: 4 }),
    );
  });

  it('fails the job with the reasons when the report says no program was converted', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'BROKEN.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeJob(args, 'broken', 'BrokenTasklet');
        await writeReport(args, {
          converted: 0,
          failed: 1,
          failures: [{ programId: 'BROKEN', file: 'BROKEN.cob', line: 7, reason: 'Unknown Symbol : X' }],
        });
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
    );

    await expect(buildAdapter().execute(baseInput)).rejects.toThrow(
      /No program could be converted: BROKEN: Unknown Symbol : X/,
    );
    expect(storage.writeFiles).not.toHaveBeenCalled();
    expect(errorLogs.create).toHaveBeenCalledWith(expect.objectContaining({ lineNumber: 7 }));
  });

  it('does not fail the job when recording a parse error fails (e.g. a DB validation error for an unrelated program in the same bundle)', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeJob(args, 'ok', 'OkTasklet');
        return {
          code: 0,
          stdout: [
            'Parsing Cobol started for: UNRELATED.cob',
            'com.res.cobol.parser.ParseException: Encountered "x" at line 4, column 8.',
            'Errors encountered. Processing terminated.',
          ].join('\n'),
          stderr: '',
          timedOut: false,
        };
      },
    );
    (errorLogs.create as jest.Mock).mockRejectedValue(new Error('ErrorLog validation failed'));

    const output = await buildAdapter().execute(baseInput);

    expect(output).toEqual({ resultReference: 'results/p1/job-2/uuid', toolVersion: 'tool2java' });
  });

  it('throws when no .java files were generated', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'BROKEN.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockResolvedValue({
      code: 0,
      stdout: 'Errors encountered. Processing terminated.',
      stderr: '',
      timedOut: false,
    });

    await expect(buildAdapter().execute(baseInput)).rejects.toThrow(/No Java files were generated/);
    expect(storage.writeFiles).not.toHaveBeenCalled();
  });

  it('throws CopybookDependencyBlockedError and never shells out to tool2java when the screen is BLOCKED', async () => {
    (screens.findById as jest.Mock).mockResolvedValue({
      id: 'scr-1',
      dependencyStatus: 'BLOCKED',
      dependencies: [
        {
          copyName: 'ACCTFILE-STATUS',
          status: 'MISSING',
          message: "COPYBOOK 'ACCTFILE-STATUS' referenced by 'CBACT01C.cbl' could not be found.",
        },
      ],
    });

    await expect(
      buildAdapter().execute({ ...baseInput, screenId: 'scr-1' }),
    ).rejects.toBeInstanceOf(CopybookDependencyBlockedError);
    expect(toolRunner.runConversionTool).not.toHaveBeenCalled();
  });

  it('does not block a legacy BLOCKED screen whose only MISSING entries are IBM system copybooks', async () => {
    (screens.findById as jest.Mock).mockResolvedValue({
      id: 'scr-1',
      dependencyStatus: 'BLOCKED',
      dependencies: [
        { copyName: 'COCOM01Y', status: 'RESOLVED', resolvedFile: 'COCOM01Y.cpy' },
        { copyName: 'DFHAID', status: 'MISSING' },
        { copyName: 'CMQV', status: 'MISSING' },
      ],
    });
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL SOURCE');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeJob(args, 'ok', 'OkTasklet');
        return { code: 0, stdout: 'Done in 0s.', stderr: '', timedOut: false };
      },
    );

    await buildAdapter().execute({ ...baseInput, screenId: 'scr-1' });

    expect(toolRunner.runConversionTool).toHaveBeenCalled();
  });

  it('proceeds to run tool2java when the screen is READY_FOR_CONVERSION', async () => {
    (screens.findById as jest.Mock).mockResolvedValue({
      id: 'scr-1',
      dependencyStatus: 'READY_FOR_CONVERSION',
    });
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL SOURCE');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        await writeJob(args, 'ok', 'OkTasklet');
        return { code: 0, stdout: 'Done in 0s.', stderr: '', timedOut: false };
      },
    );

    await buildAdapter().execute({ ...baseInput, screenId: 'scr-1' });

    expect(toolRunner.runConversionTool).toHaveBeenCalled();
  });

  it('runs tool2java on a normalized copy of the bundle, leaving the stored upload untouched', async () => {
    const original = [
      '       PROCEDURE DIVISION.',
      '           EXEC CICS RETURN TRANSID(WS-TRANID) RESP(WS-RESP) END-EXEC.',
    ].join('\n');
    await fs.promises.mkdir(path.join(sourceDir, 'app'));
    await fs.promises.writeFile(path.join(sourceDir, 'app', 'PGM.cbl'), original);
    let seen: { dir: string; program: string; stubs: string[] } | undefined;
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        const dir = argAfter(args, '-project');
        seen = {
          dir,
          program: await fs.promises.readFile(path.join(dir, 'app', 'PGM.cbl'), 'latin1'),
          stubs: (await fs.promises.readdir(path.join(dir, 'app'))).filter((f) => f !== 'PGM.cbl'),
        };
        await writeJob(args, 'pgm', 'PgmTasklet');
        return { code: 0, stdout: 'Done in 0s.', stderr: '', timedOut: false };
      },
    );

    await buildAdapter().execute(baseInput);

    expect(seen?.dir).not.toBe(sourceDir);
    expect(seen?.program).not.toMatch(/^ {7}.*RESP\(/m);
    expect(seen?.program).toMatch(/^ +EXEC CICS RETURN TRANSID\(WS-TRANID\)$/m);
    expect(seen?.stubs.sort()).toEqual(['DFHAID.cpy', 'DFHBMSCA.cpy']);
    expect(await fs.promises.readFile(path.join(sourceDir, 'app', 'PGM.cbl'), 'latin1')).toBe(
      original,
    );
  });
});
