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

  it('translates COBOL and stores the generated .java files even though exit code is always 0', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'BUBBLESORT.cob'), 'COBOL SOURCE');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[], options: { cwd: string }) => {
        expect(args.slice(args.indexOf('-pp'), args.indexOf('-pp') + 2)).toEqual([
          '-pp',
          'cobolprogramclasses',
        ]);
        expect(args.slice(args.indexOf('-dp'), args.indexOf('-dp') + 2)).toEqual([
          '-dp',
          'cobolprogramclasses',
        ]);
        // tool2java only reliably honors -odir for the first file it writes; real runs show
        // subsequent programs land under "<cwd>/cobolprogramclasses/<program>/..." instead —
        // reproduce that here rather than writing into the (unused, from the tool's own
        // perspective) -odir value.
        const generatedDir = path.join(options.cwd, 'cobolprogramclasses');
        await fs.promises.mkdir(generatedDir, { recursive: true });
        await fs.promises.writeFile(
          path.join(generatedDir, 'Bubblesort.java'),
          'public class Bubblesort {}',
        );
        return {
          code: 0,
          stdout: 'Parsing Cobol started for: BUBBLESORT.cob\nDone in 0s.',
          stderr: '',
          timedOut: false,
        };
      },
    );

    const output = await buildAdapter().execute(baseInput);

    expect(output).toEqual({ resultReference: 'results/p1/job-2/uuid', toolVersion: 'tool2java' });
    expect(storage.writeFiles).toHaveBeenCalledWith(
      'results/p1/job-2',
      expect.arrayContaining([
        expect.objectContaining({ relativePath: 'cobolprogramclasses/Bubblesort.java' }),
      ]),
    );
    expect(errorLogs.create).not.toHaveBeenCalled();
  });

  it('isolates overlapping attempts of the same job in distinct working directories', async () => {
    const workingDirectories: string[] = [];
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, _args: string[], options: { cwd: string }) => {
        workingDirectories.push(options.cwd);
        await fs.promises.writeFile(path.join(options.cwd, 'Result.java'), 'class Result {}');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { code: 0, stdout: '', stderr: '', timedOut: false };
      },
    );
    await Promise.all([buildAdapter().execute(baseInput), buildAdapter().execute(baseInput)]);
    expect(new Set(workingDirectories).size).toBe(2);
    expect(storage.writeFiles).toHaveBeenCalledTimes(2);
  });

  it('records an ErrorLogRecord parsed from a ParseException block', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL');
    await fs.promises.writeFile(path.join(sourceDir, 'BROKEN.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        const outDir = args[4];
        await fs.promises.writeFile(path.join(outDir, 'Ok.java'), 'public class Ok {}');
        return {
          code: 0,
          stdout: [
            'Parsing Cobol started for: BROKEN.cob',
            'com.res.cobol.parser.ParseException: Encountered "x" at line 4, column 8.',
            'Errors encountered. Processing terminated.',
          ].join('\n'),
          stderr: '',
          timedOut: false,
        };
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

  it('does not fail the job when recording a parse error fails (e.g. a DB validation error for an unrelated program in the same -dld batch)', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.cob'), 'COBOL');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(
      async (_exe: string, args: string[]) => {
        const outDir = args[4];
        await fs.promises.writeFile(path.join(outDir, 'Ok.java'), 'public class Ok {}');
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
        const outDir = args[4];
        await fs.promises.writeFile(path.join(outDir, 'Ok.java'), 'public class Ok {}');
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
        const outDir = args[4];
        await fs.promises.writeFile(path.join(outDir, 'Ok.java'), 'public class Ok {}');
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
      async (_exe: string, args: string[], options: { cwd: string }) => {
        const dir = args[args.length - 1];
        seen = {
          dir,
          program: await fs.promises.readFile(path.join(dir, 'app', 'PGM.cbl'), 'latin1'),
          stubs: (await fs.promises.readdir(path.join(dir, 'app'))).filter((f) => f !== 'PGM.cbl'),
        };
        await fs.promises.writeFile(path.join(options.cwd, 'Pgm.java'), 'public class Pgm {}');
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
