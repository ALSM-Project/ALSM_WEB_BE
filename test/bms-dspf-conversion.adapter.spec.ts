import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { BmsDspfConversionAdapter } from '../src/modules/conversions/infrastructure/bms-dspf-conversion.adapter';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ErrorLogRepository } from '../src/modules/conversions/domain/error-log.types';
import { StoragePort } from '../src/shared/storage/storage.port';
import * as toolRunner from '../src/modules/conversions/infrastructure/conversion-tool-runner.util';

jest.mock('../src/modules/conversions/infrastructure/conversion-tool-runner.util', () => ({
  ...jest.requireActual('../src/modules/conversions/infrastructure/conversion-tool-runner.util'),
  runConversionTool: jest.fn(),
}));

import { FieldMappingRepository } from '../src/modules/conversions/domain/field-mapping.types';

describe('BmsDspfConversionAdapter', () => {
  let sourceDir: string;
  const configValues: Record<string, unknown> = {
    TOOL_CONVERT_DIR: '/tools/convert2fe',
    PYTHON_EXECUTABLE: 'python',
    CONVERSION_TOOL_TIMEOUT_MS: 5000,
  };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const storage: Partial<StoragePort> = {
    resolvePath: jest.fn(),
    writeFiles: jest.fn(),
  };
  const errorLogs = { create: jest.fn() };

  const baseInput = {
    conversionJobId: 'job-1',
    organizationId: 'org-1',
    projectId: 'p1',
    inputReference: 'src-ref',
    conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    sourceDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alsm-test-bms-src-'));
    (storage.resolvePath as jest.Mock).mockReturnValue(sourceDir);
    (storage.writeFiles as jest.Mock).mockResolvedValue('results/p1/job-1/uuid');
  });

  afterEach(async () => {
    await fs.promises.rm(sourceDir, { recursive: true, force: true });
  });

  const fieldMappings = { findByScreen: jest.fn().mockResolvedValue(null) };

  function buildAdapter(): BmsDspfConversionAdapter {
    return new BmsDspfConversionAdapter(
      config as unknown as ConfigService,
      storage as StoragePort,
      errorLogs as unknown as ErrorLogRepository,
      fieldMappings as unknown as FieldMappingRepository,
    );
  }

  it('runs bms2react.py and stores the generated .tsx files', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'LOGIN.bms'), 'BMS SOURCE');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(async (_exe: string, args: string[]) => {
      const outDir = args[4];
      await fs.promises.writeFile(path.join(outDir, 'LOGIN.tsx'), 'export const Login = () => null;');
      await fs.promises.writeFile(path.join(outDir, 'bmsRoutes.tsx'), 'export const routes = [];');
      return { code: 0, stdout: 'Exported router name: bmsRoutes.tsx', stderr: '', timedOut: false };
    });

    const output = await buildAdapter().execute(baseInput);

    expect(output).toEqual({ resultReference: 'results/p1/job-1/uuid', toolVersion: 'convert2fe' });
    expect(storage.writeFiles).toHaveBeenCalledWith(
      'results/p1/job-1',
      expect.arrayContaining([expect.objectContaining({ relativePath: 'LOGIN.tsx' })]),
    );
    expect(errorLogs.create).not.toHaveBeenCalled();
  });

  it('records an ErrorLogRecord for a file that failed to parse while still succeeding overall', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'OK.bms'), 'BMS');
    await fs.promises.writeFile(path.join(sourceDir, 'BROKEN.bms'), 'BMS');
    (toolRunner.runConversionTool as jest.Mock).mockImplementation(async (_exe: string, args: string[]) => {
      const outDir = args[4];
      await fs.promises.writeFile(path.join(outDir, 'OK.tsx'), 'export const Ok = () => null;');
      return { code: 0, stdout: 'BROKEN failed to parse', stderr: '', timedOut: false };
    });

    await buildAdapter().execute(baseInput);

    expect(errorLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        organizationId: 'org-1',
        offendingCode: 'BROKEN',
        errorCode: 'BMS_DSPF_PARSE_FAILED',
      }),
    );
  });

  it('falls back to parsing BMS source when no React components were generated', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'BROKEN.bms'), 'BMS');
    (toolRunner.runConversionTool as jest.Mock).mockResolvedValue({
      code: 0,
      stdout: 'nothing generated',
      stderr: '',
      timedOut: false,
    });

    const result = await buildAdapter().execute(baseInput);
    
    expect(result.resultReference).toEqual('results/p1/job-1/uuid');
    expect(storage.writeFiles).toHaveBeenCalled();
  });

  it('throws when the uploaded source has no .bms/.dspf files', async () => {
    await fs.promises.writeFile(path.join(sourceDir, 'readme.txt'), 'not a screen');

    await expect(buildAdapter().execute(baseInput)).rejects.toThrow(/No \.bms or \.dspf files/);
    expect(toolRunner.runConversionTool).not.toHaveBeenCalled();
  });
});
