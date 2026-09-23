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
import { CopybookDependencyBlockedError } from '../domain/copybook-dependency-blocked.error';
import type { DependencyEntry } from '../domain/copybook-dependency.types';
import { SCREEN_REPOSITORY, ScreenRepository } from '../../screens/domain/screen.types';
import { runConversionTool } from './conversion-tool-runner.util';

interface ParsedToolError {
  fileName: string;
  message: string;
  lineNumber: number;
}

/**
 * Shells out to tool2java's built jar (com.res.cobol.Main). No COBOL parser logic is reimplemented here.
 * The tool always exits 0 (confirmed by manual smoke test) — success/failure is determined by parsing
 * stdout and checking whether any .java files were actually produced.
 */
@Injectable()
export class CobolJavaConversionAdapter {
  private readonly logger = new Logger(CobolJavaConversionAdapter.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(ERROR_LOG_REPOSITORY) private readonly errorLogs: ErrorLogRepository,
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
  ) {}

  async execute(input: ConversionEngineInput): Promise<ConversionEngineOutput> {
    if (!input.inputReference) {
      throw new Error('COBOL conversion requires an uploaded source (inputReference is missing)');
    }

    if (input.screenId) {
      const screen = await this.screens.findById(input.screenId, input.organizationId);
      if (screen?.dependencyStatus === 'BLOCKED') {
        throw new CopybookDependencyBlockedError(this.buildBlockedMessage(screen.dependencies ?? []));
      }
    }

    const jarPath = this.config.get<string>('TOOL2JAVA_JAR_PATH');
    if (!jarPath) {
      throw new Error('TOOL2JAVA_JAR_PATH is not configured');
    }

    const sourceDir = this.storage.resolvePath(input.inputReference);
    // Each job gets its own working directory: the tool writes a hard-coded temp file
    // ($temporary.file) into its CWD, so concurrent jobs must never share one.
    const jobWorkDir = path.join(os.tmpdir(), 'alsm-conversions', input.conversionJobId);
    const outDir = path.join(jobWorkDir, 'out');
    await fs.promises.mkdir(outDir, { recursive: true });
    const timeoutMs = this.config.get<number>('CONVERSION_TOOL_TIMEOUT_MS') ?? 120000;
    const javaExecutable = this.config.get<string>('JAVA_EXECUTABLE') || 'java';

    try {
      const result = await runConversionTool(
        javaExecutable,
        [
          '-jar',
          jarPath,
          '-dld',
          '-odir',
          // tool2java concatenates outputDir + fileName with no separator of its own
          // (Files.java openClassFile(outputDir, filePath)) — without a trailing separator
          // here it writes garbled paths like "outClassName.java" and can throw.
          outDir + path.sep,
          // Without -pp, RESConfig.getProgramPackage() is null and every file write throws
          // a NullPointerException inside tool2java (silently caught, logged, and skipped —
          // "No Java files were generated" with no other indication why).
          '-pp',
          'cobolprogramclasses',
          '-dp0',
          '-fixed',
          '-c2',
          '-overwrite',
          sourceDir,
        ],
        { cwd: jobWorkDir, timeoutMs },
      );
      if (result.timedOut) {
        throw new Error(`tool2java timed out after ${timeoutMs}ms`);
      }

      // tool2java only reliably honors -odir for the very first class file it writes; after
      // that its own internal RESConfig output-dir state resets per program and it falls back
      // to writing "<package>/<program>/<Class>.java" relative to the process CWD instead
      // (confirmed by direct reproduction — real files land as siblings of -odir, not inside
      // it). Search the whole job working directory rather than trusting -odir alone.
      const generatedFiles = await this.listJavaFiles(jobWorkDir);
      if (generatedFiles.length === 0) {
        throw new Error(`No Java files were generated. Tool output: ${result.stdout.slice(0, 2000)}`);
      }

      await this.recordParseErrors(input, result.stdout);

      const files = await Promise.all(
        generatedFiles.map(async (absolutePath) => ({
          relativePath: path.relative(jobWorkDir, absolutePath).split(path.sep).join('/'),
          content: await fs.promises.readFile(absolutePath),
        })),
      );
      const resultReference = await this.storage.writeFiles(
        `results/${input.projectId}/${input.conversionJobId}`,
        files,
      );
      return { resultReference, toolVersion: 'tool2java' };
    } finally {
      await fs.promises.rm(jobWorkDir, { recursive: true, force: true }).catch((error: unknown) => {
        this.logger.warn(`Failed to clean up workspace ${jobWorkDir}: ${String(error)}`);
      });
    }
  }

  /** Flattens the unresolved entries (top-level and nested) of a BLOCKED dependency tree into
   * one clear, actionable message — surfaced as the job's errorMessage. */
  private buildBlockedMessage(dependencies: DependencyEntry[]): string {
    const unresolved: string[] = [];
    const collect = (entries: DependencyEntry[]) => {
      for (const entry of entries) {
        if (entry.status !== 'RESOLVED') {
          unresolved.push(entry.message ?? `${entry.copyName}: ${entry.status}`);
        } else if (entry.dependencies) {
          collect(entry.dependencies);
        }
      }
    };
    collect(dependencies);
    return `Blocked by unresolved copybook dependencies: ${unresolved.join(' | ')}`;
  }

  private async listJavaFiles(dir: string): Promise<string[]> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listJavaFiles(fullPath)));
      } else if (entry.name.toLowerCase().endsWith('.java')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  /** Best-effort: -dld compiles every program in the shared bundle in one run, so a single
   * job's stdout can contain parse errors for programs that have nothing to do with the
   * screen actually being converted. Logging one of those must never fail the whole job —
   * a schema/DB issue while writing one ErrorLogRecord previously crashed conversions for
   * completely unrelated, otherwise-successful screens. */
  private async recordParseErrors(input: ConversionEngineInput, stdout: string): Promise<void> {
    for (const error of this.parseToolErrors(stdout)) {
      try {
        await this.errorLogs.create({
          projectId: input.projectId,
          organizationId: input.organizationId,
          screenName: input.screenId ?? error.fileName,
          errorCode: 'COBOL_TRANSLATION_FAILED',
          severity: ErrorLogSeverity.ERROR,
          status: ErrorLogStatus.UNRESOLVED,
          lineNumber: error.lineNumber,
          offendingCode: error.fileName,
          suggestedPatch: {
            // tool2java's own compiler errors have no "suggested fix" the way an AI-assisted
            // patch would — these fields exist for that other use case and are required by
            // the shared ErrorLog schema, so they get a clear placeholder here instead of ''
            // (Mongoose's required validator rejects an empty string too).
            offendingLine: 'N/A',
            suggestedLine: 'N/A',
            reason: error.message.slice(0, 500) || 'tool2java could not translate this file — manual review required.',
          },
        });
      } catch (logError) {
        this.logger.warn(`Failed to record parse error for ${error.fileName}: ${String(logError)}`);
      }
    }
  }

  /** Best-effort parse of tool2java's human-oriented console log — this tool has no structured error output. */
  private parseToolErrors(stdout: string): ParsedToolError[] {
    const blocks = stdout.split(/(?=Parsing Cobol started for: )/g);
    const errors: ParsedToolError[] = [];
    for (const block of blocks) {
      const fileMatch = block.match(/Parsing Cobol started for:\s*(.+)/);
      if (!fileMatch) continue;
      const hasError = /ParseException|Errors encountered|Exception/i.test(block);
      if (!hasError) continue;
      const lineMatch = block.match(/at line (\d+)/i);
      errors.push({
        fileName: path.basename(fileMatch[1].trim()),
        message: block.trim(),
        lineNumber: lineMatch ? Number(lineMatch[1]) : 0,
      });
    }
    return errors;
  }
}
