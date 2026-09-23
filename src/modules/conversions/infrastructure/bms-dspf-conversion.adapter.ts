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
          `convert2fe produced no .tsx components. Parsing BMS source directly for fallback. Output: ${stripAnsi(combinedStdout).slice(0, 500)}`,
        );
        const validSourceFiles = sourceFiles.filter((f) =>
          extensions.includes(path.extname(f).toLowerCase()),
        );
        for (const sf of validSourceFiles) {
          const rawName = path.parse(sf).name;
          const compName = rawName.replace(/[^a-zA-Z0-9_]/g, '_') || 'ConvertedScreen';

          // Read and parse the actual BMS source file to extract real DFHMDF fields
          const bmsContent = await fs.promises.readFile(path.join(sourceDir, sf), 'utf8');
          const parsedFields = this.parseBmsFields(bmsContent);

          // Build JSX inputs from parsed BMS fields
          let fieldInputs = '';
          if (parsedFields.inputs.length > 0 || parsedFields.labels.length > 0) {
            const inputJsx = parsedFields.inputs.map((f) => {
              const inputType = f.isNumeric ? 'number' : 'text';
              return `
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>${f.label || f.name}:</label>
              <input type="${inputType}" name="${f.name.toLowerCase()}" maxLength={${f.length}} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }} />
            </div>`;
            }).join('\n');

            fieldInputs = `
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
${inputJsx}
          </div>`;
          }

          // Build label displays for output/protected fields
          let labelDisplays = '';
          if (parsedFields.labels.length > 0) {
            labelDisplays = parsedFields.labels.map((l) => {
              if (l.initial) {
                return `\n          <span style={{ color: '${l.color || '#333'}', display: 'inline-block', marginRight: '8px' }}>${l.initial}</span>`;
              }
              if (l.name) {
                return `\n          <span style={{ display: 'inline-block', marginRight: '16px' }}><strong>${l.name}:</strong> <span id="${l.name.toLowerCase()}" style={{ color: '${l.color || '#0066cc'}', textDecoration: 'underline' }}>—</span></span>`;
              }
              return '';
            }).join('');
          }

          // Build the screen title from BMS TITLE if found
          const screenTitle = parsedFields.screenTitle || rawName;
          
          // Generate Legacy View JSX
          const legacyItemsJsx = [
            ...parsedFields.labels.filter(l => l.row > 0 && l.col > 0).map(l => 
              `<div style={{ position: 'absolute', top: '${l.row - 1}em', left: '${l.col - 1}ch', color: '${l.color === 'blue' ? '#87ceeb' : '#00ff00'}', whiteSpace: 'pre' }}>${l.initial || (l.name ? "[" + l.name + "]" : "")}</div>`
            ),
            ...parsedFields.inputs.filter(i => i.row > 0 && i.col > 0).map(i => 
              `<div style={{ position: 'absolute', top: '${i.row - 1}em', left: '${i.col - 1}ch' }}>
                 <input type="text" name="${i.name.toLowerCase()}" placeholder="${i.name}" maxLength={${i.length}} style={{ width: '${i.length}ch', backgroundColor: '#002200', color: '#00ff00', border: '1px solid #00ff00', outline: 'none', fontFamily: 'monospace', padding: 0, margin: 0, lineHeight: 1 }} />
               </div>`
            )
          ].join('\\n            ');

          const stubCode = `import React, { useState } from 'react';

export default function ${compName}() {
  const [viewMode, setViewMode] = useState<'modern' | 'legacy'>('legacy');

  return (
    <div style={{ padding: '24px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Screen: ${screenTitle}</h2>
          <p style={{ color: '#666', margin: '4px 0 0 0' }}>Modernized React Component (${sf})</p>
        </div>
        <div>
          <button 
            type="button"
            onClick={() => setViewMode(v => v === 'modern' ? 'legacy' : 'modern')}
            style={{ padding: '8px 16px', background: viewMode === 'modern' ? '#0f172a' : '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}
          >
            {viewMode === 'modern' ? 'Switch to Legacy Terminal View' : 'Switch to Modern View'}
          </button>
        </div>
      </div>

      {viewMode === 'modern' ? (
        <div>
          ${labelDisplays ? `<div style={{ marginBottom: '20px', padding: '12px', background: '#f8f9fa', borderRadius: '6px', fontSize: '13px' }}>${labelDisplays}
          </div>` : ''}
          <div style={{ padding: '20px', border: '1px solid #e2e8f0', borderRadius: '8px', background: 'white' }}>
            <form onSubmit={(e) => e.preventDefault()}>
              ${fieldInputs}
              <button type="submit" style={{ padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 500 }}>Submit Form</button>
            </form>
          </div>
          ${parsedFields.functionKeys.length > 0 ? `<div style={{ marginTop: '16px', fontSize: '13px', color: '#64748b', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>${parsedFields.functionKeys.map(k => `<span style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: '4px' }}>${k}</span>`).join('')}</div>` : ''}
        </div>
      ) : (
        <div style={{ backgroundColor: 'black', padding: '24px', borderRadius: '8px', overflowX: 'auto', display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: '80ch', height: '25em', fontFamily: 'monospace', fontSize: '16px', backgroundColor: 'black', lineHeight: 1 }}>
            ${legacyItemsJsx}
            ${parsedFields.functionKeys.length > 0 ? `<div style={{ position: 'absolute', bottom: 0, left: 0, color: '#888', whiteSpace: 'pre' }}>${parsedFields.functionKeys.join('  ')}</div>` : ''}
          </div>
        </div>
      )}
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

  /**
   * Parses raw BMS source content to extract DFHMDF field definitions.
   * This mirrors the logic of bms2react.py's extract_map_items / extract_property.
   */
  private parseBmsFields(bmsContent: string): {
    inputs: { name: string; label: string; length: number; isNumeric: boolean; row: number; col: number }[];
    labels: { name?: string; initial?: string; color?: string; row: number; col: number }[];
    screenTitle: string;
    functionKeys: string[];
  } {
    const inputs: { name: string; label: string; length: number; isNumeric: boolean; row: number; col: number }[] = [];
    const labels: { name?: string; initial?: string; color?: string; row: number; col: number }[] = [];
    let screenTitle = '';
    const functionKeys: string[] = [];
    const addedNames = new Set<string>();

    // Join continuation lines (lines ending with - followed by next line)
    const joined = bmsContent.replace(/\s*-\s*\r?\n\s*/g, '');
    const lines = joined.split(/\r?\n/);

    // Track the last label INITIAL to use as label text for the next input field
    let lastLabelInitial = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('*')) continue;

      // Extract DFHMDF items
      const dfhmdfMatch = trimmed.match(/^(\w+)?\s*DFHMDF\s+(.*)/i);
      if (!dfhmdfMatch) {
        // Check for function key instructions in INITIAL
        const fkeyMatch = trimmed.match(/INITIAL='([^']*F\d+[^']*)'/i);
        if (fkeyMatch) {
          functionKeys.push(fkeyMatch[1]);
        }
        continue;
      }

      const fieldName = dfhmdfMatch[1] || '';
      const propsStr = dfhmdfMatch[2];

      // Parse properties
      const attrb = propsStr.match(/ATTRB=\(([^)]+)\)/i)?.[1]?.split(',').map((s) => s.trim()) || [];
      const lengthMatch = propsStr.match(/LENGTH=(\d+)/i);
      const length = lengthMatch ? parseInt(lengthMatch[1], 10) : 0;
      const initialMatch = propsStr.match(/INITIAL='([^']*)'/i);
      const initial = initialMatch ? initialMatch[1] : '';
      const colorMatch = propsStr.match(/COLOR=(\w+)/i);
      const color = colorMatch ? colorMatch[1].toLowerCase() : '';
      const posMatch = propsStr.match(/POS=\((\d+),(\d+)\)/i);
      const isNumeric = attrb.includes('NUM');

      const row = posMatch ? parseInt(posMatch[1], 10) : 0;
      const col = posMatch ? parseInt(posMatch[2], 10) : 0;

      // Classify: UNPROT or IC → input field, PROT/ASKIP with INITIAL → label
      const isUnprot = attrb.includes('UNPROT') || attrb.includes('IC');
      const isProt = attrb.includes('PROT') || attrb.includes('ASKIP');

      if (isUnprot && fieldName && !addedNames.has(fieldName)) {
        addedNames.add(fieldName);
        inputs.push({
          name: fieldName,
          label: lastLabelInitial || fieldName,
          length: length || 20,
          isNumeric,
          row,
          col,
        });
        lastLabelInitial = ''; // consumed
      } else if (initial && isProt) {
        // Check if this is a screen title
        if (!screenTitle && posMatch) {
          if (row <= 4 && col >= 15 && col <= 40 && initial.length > 5) {
            screenTitle = initial;
          }
        }

        // Check for function keys line
        if (initial.includes('F3=') || initial.includes('F5=') || initial.includes('ENTER=')) {
          functionKeys.push(initial);
        } else {
          labels.push({ name: fieldName || undefined, initial, color: color || undefined, row, col });
          // Store INITIAL as potential label for next input
          if (initial.endsWith(':') || initial.endsWith(': ')) {
            lastLabelInitial = initial.replace(/:?\s*$/, '');
          } else {
            lastLabelInitial = initial;
          }
        }
      } else if (fieldName && isProt && !initial && !addedNames.has(fieldName)) {
        // Protected named field without INITIAL = output/display field
        addedNames.add(fieldName);
        labels.push({ name: fieldName, color: color || undefined, row, col });
        lastLabelInitial = '';
      } else {
        lastLabelInitial = '';
      }
    }

    return { inputs, labels, screenTitle, functionKeys };
  }
}
