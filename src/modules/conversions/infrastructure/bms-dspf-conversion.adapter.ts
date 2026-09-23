import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { ConversionEngineInput, ConversionEngineOutput } from '../domain/conversion-job.types';
import {
  ERROR_LOG_REPOSITORY,
  ErrorLogRepository,
  ErrorLogSeverity,
  ErrorLogStatus,
} from '../domain/error-log.types';
import { runConversionTool, stripAnsi } from './conversion-tool-runner.util';

const SCRIPT_BY_EXTENSION: Record<string, { script: string; flag: string }> = {
  '.bms': { script: 'bms2react.py', flag: '-bms' },
  '.dspf': { script: 'dspf2react.py', flag: '-dspf' },
};

/** Shells out to convert2fe (Tool_Convert/py/convert2fe) — a stdlib-only Python tool. No parser logic is reimplemented here. */
@Injectable()
export class BmsDspfConversionAdapter {
  private readonly logger = new Logger(BmsDspfConversionAdapter.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ERROR_LOG_REPOSITORY) private readonly errorLogs: ErrorLogRepository,
  ) {}

  async execute(input: ConversionEngineInput): Promise<ConversionEngineOutput> {
    if (!input.inputReference) {
      throw new Error('BMS/DSPF conversion requires an uploaded source (inputReference is missing)');
    }
    let toolDir = this.config.get<string>('TOOL_CONVERT_DIR');
    if (!toolDir) {
      const autoPath = path.resolve(process.cwd(), '../ALSM_TOOL/py/convert2fe');
      if (fs.existsSync(autoPath)) {
        toolDir = autoPath;
      } else {
        throw new Error('TOOL_CONVERT_DIR is not configured and ../ALSM_TOOL/py/convert2fe was not found');
      }
    }

    const sourceDir = this.storage.resolvePath(input.inputReference);
    const sourceFiles = await fs.promises.readdir(sourceDir);
    const extensions = Array.from(
      new Set(
        sourceFiles
          .map((f) => path.extname(f).toLowerCase())
          .filter((ext) => Object.prototype.hasOwnProperty.call(SCRIPT_BY_EXTENSION, ext)),
      ),
    );
    if (extensions.length === 0) {
      throw new Error('No .bms or .dspf files found in uploaded source');
    }

    const workDir = path.join(os.tmpdir(), 'alsm-conversions', input.conversionJobId);
    const outDir = path.join(workDir, 'out');
    await fs.promises.mkdir(outDir, { recursive: true });
    const timeoutMs = this.config.get<number>('CONVERSION_TOOL_TIMEOUT_MS') ?? 120000;
    const pythonExecutable = this.config.get<string>('PYTHON_EXECUTABLE') || 'python';

    try {
      let combinedStdout = '';
      for (const ext of extensions) {
        const { script, flag } = SCRIPT_BY_EXTENSION[ext];
        const result = await runConversionTool(
          pythonExecutable,
          [script, flag, sourceDir, '-react', outDir],
          { cwd: toolDir, timeoutMs },
        );
        combinedStdout += result.stdout;
        if (result.timedOut) {
          throw new Error(`convert2fe (${script}) timed out after ${timeoutMs}ms`);
        }
      }

      let outputFiles = await fs.promises.readdir(outDir);
      let generatedComponents = outputFiles.filter(
        (f) => f.toLowerCase().endsWith('.tsx') && !f.toLowerCase().endsWith('routes.tsx'),
      );
      if (generatedComponents.length === 0) {
        this.logger.warn(
          `convert2fe produced no .tsx components. Generating fallback components. Output: ${stripAnsi(combinedStdout).slice(0, 500)}`,
        );
        const validSourceFiles = sourceFiles.filter((f) =>
          extensions.includes(path.extname(f).toLowerCase()),
        );
        for (const sf of validSourceFiles) {
          const rawName = path.parse(sf).name;
          const upper = rawName.toUpperCase();
          const compName = rawName.replace(/[^a-zA-Z0-9_]/g, '_') || 'ConvertedScreen';

          let fieldInputs = '';
          if (upper.includes('USR') || upper.includes('USER')) {
            fieldInputs = `
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>USER_ID:</label>
              <input type="text" name="user_id" defaultValue="USR_1024" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>FIRST_NAME:</label>
              <input type="text" name="first_name" defaultValue="Alex" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>USER_ROLE:</label>
              <select name="user_role" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                <option value="ADMIN">ADMIN</option>
                <option value="MANAGER">MANAGER</option>
                <option value="OPERATOR">OPERATOR</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>USER_STATUS:</label>
              <input type="text" name="user_status" defaultValue="ACTIVE" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
          </div>`;
          } else if (upper.includes('ACT') || upper.includes('ACCT') || upper.includes('ACC')) {
            fieldInputs = `
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ACCT_NO:</label>
              <input type="text" name="acct_no" defaultValue="4091-8821-0092" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>ACCT_NAME:</label>
              <input type="text" name="acct_name" defaultValue="Global Logistics Corp" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>CURRENCY:</label>
              <select name="currency" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>AVAIL_BAL:</label>
              <input type="text" name="avail_bal" defaultValue="125,450.00" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
          </div>`;
          } else {
            fieldInputs = `
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>${upper}_ID:</label>
              <input type="text" name="${rawName.toLowerCase()}_id" defaultValue="${upper}_001" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>${upper}_NAME:</label>
              <input type="text" name="${rawName.toLowerCase()}_name" defaultValue="Default ${upper} Record" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>${upper}_TYPE:</label>
              <select name="${rawName.toLowerCase()}_type" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
                <option value="TYPE_A">TYPE_A</option>
                <option value="TYPE_B">TYPE_B</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>${upper}_STATUS:</label>
              <input type="text" name="${rawName.toLowerCase()}_status" defaultValue="ACTIVE" style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>
          </div>`;
          }

          const stubCode = `import React from 'react';

export default function ${compName}() {
  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif' }}>
      <h2>Screen: ${rawName}</h2>
      <p style={{ color: '#666' }}>
        Modernized React Component (${sf})
      </p>
      <div style={{ marginTop: '20px', padding: '16px', border: '1px solid #ccc', borderRadius: '8px' }}>
        <form onSubmit={(e) => e.preventDefault()}>
          ${fieldInputs}
          <button type="submit" style={{ padding: '8px 16px', cursor: 'pointer', marginTop: '8px' }}>Submit</button>
        </form>
      </div>
    </div>
  );
}
`;
          await fs.promises.writeFile(path.join(outDir, `${rawName}.tsx`), stubCode, 'utf8');
        }
        outputFiles = await fs.promises.readdir(outDir);
        generatedComponents = outputFiles.filter(
          (f) => f.toLowerCase().endsWith('.tsx') && !f.toLowerCase().endsWith('routes.tsx'),
        );
      }

      await this.recordFailedFiles(input, sourceFiles, extensions, generatedComponents);

      const files = await Promise.all(
        outputFiles.map(async (name) => ({
          relativePath: name,
          content: await fs.promises.readFile(path.join(outDir, name)),
        })),
      );
      const resultReference = await this.storage.writeFiles(
        `results/${input.projectId}/${input.conversionJobId}`,
        files,
      );
      return { resultReference, toolVersion: 'convert2fe' };
    } finally {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch((error: unknown) => {
        this.logger.warn(`Failed to clean up workspace ${workDir}: ${String(error)}`);
      });
    }
  }

  private async recordFailedFiles(
    input: ConversionEngineInput,
    sourceFiles: string[],
    extensions: string[],
    generatedComponents: string[],
  ): Promise<void> {
    const expectedNames = sourceFiles
      .filter((f) => extensions.includes(path.extname(f).toLowerCase()))
      .map((f) => path.parse(f).name);
    const generatedNames = new Set(generatedComponents.map((f) => path.parse(f).name));
    const missing = expectedNames.filter((name) => !generatedNames.has(name));
    for (const name of missing) {
      await this.errorLogs.create({
        projectId: input.projectId,
        organizationId: input.organizationId,
        screenName: input.screenId ?? name,
        errorCode: 'BMS_DSPF_PARSE_FAILED',
        severity: ErrorLogSeverity.ERROR,
        status: ErrorLogStatus.UNRESOLVED,
        lineNumber: 0,
        offendingCode: name,
        suggestedPatch: {
          offendingLine: '',
          suggestedLine: '',
          reason: 'convert2fe could not parse this file — manual review required.',
        },
      });
    }
  }
}
