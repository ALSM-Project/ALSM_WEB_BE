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
import { isSystemCopybook } from '../domain/copybook-dependency-resolver';
import { SCREEN_REPOSITORY, ScreenRepository } from '../../screens/domain/screen.types';
import { runConversionTool } from './conversion-tool-runner.util';
import { normalizeBundle } from './cics-source-normalizer';

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
      // Re-derive blockers from the stored tree rather than trusting the stored flag alone:
      // screens analyzed before system copybooks (DFH*/CMQ*) were recognized still carry
      // BLOCKED purely because of those, and should convert without a re-upload.
      const blockers =
        screen?.dependencyStatus === 'BLOCKED'
          ? this.collectBlockers(screen.dependencies ?? [])
          : [];
      if (blockers.length > 0) {
        throw new CopybookDependencyBlockedError(
          `Blocked by unresolved copybook dependencies: ${blockers.join(' | ')}`,
        );
      }
    }

    let jarPath = this.config.get<string>('TOOL2JAVA_JAR_PATH');
    if (jarPath) {
      const resolved = path.isAbsolute(jarPath) ? jarPath : path.resolve(process.cwd(), jarPath);
      if (fs.existsSync(resolved)) {
        jarPath = resolved;
      } else {
        jarPath = undefined;
      }
    }
    if (!jarPath) {
      const candidatePaths = [
        path.resolve(process.cwd(), '../ALSM_TOOL_BE/target/akaBatch-1.0.jar'),
        path.resolve(process.cwd(), '../ALSM_TOOL/tool2java/target/akaBatch-1.0.jar'),
      ];
      for (const candidate of candidatePaths) {
        if (fs.existsSync(candidate)) {
          jarPath = candidate;
          break;
        }
      }
      if (!jarPath) {
        throw new Error(
          'TOOL2JAVA_JAR_PATH is not configured and neither ../ALSM_TOOL_BE/target/akaBatch-1.0.jar nor ../ALSM_TOOL/tool2java/target/akaBatch-1.0.jar was found',
        );
      }
    }

    const sourceDir = this.storage.resolvePath(input.inputReference);
    // Each job gets its own working directory: the tool writes a hard-coded temp file
    // ($temporary.file) into its CWD, so concurrent jobs must never share one.
    const jobWorkDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'alsm-conversion-'));
    const outDir = path.join(jobWorkDir, 'out');
    await fs.promises.mkdir(outDir, { recursive: true });
    const timeoutMs = this.config.get<number>('CONVERSION_TOOL_TIMEOUT_MS') ?? 120000;
    const javaExecutable = this.config.get<string>('JAVA_EXECUTABLE') || 'java';

    try {
      const toolSourceDir = await this.prepareSources(sourceDir, path.join(jobWorkDir, 'src'));
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
          // -dp <name> sets the DATA package (RESConfig.dataPackage) - distinct from -dp0,
          // which is actually an unrelated boolean flag (setLongDataPackageName(false)).
          // Without a real -dp value, RESConfig.getDataPackage() stays null and every DATA
          // division class (Cbact01cModel, etc.) crashes with a NullPointerException in
          // NameUtil.getPackageName the moment translation reaches it - the whole program's
          // translation then aborts, and the ONLY output ever written is the COBOL header
          // comment copied before that point, with the job still marked COMPLETED (the CLI
          // exits 0). Reproduced directly against real CardDemo COBOL source: every prior
          // "successful" conversion in this platform's history was silently just a header
          // stub with zero translated Java logic, until -dp was added here.
          '-dp',
          'cobolprogramclasses',
          '-dp0',
          '-fixed',
          '-c2',
          '-overwrite',
          toolSourceDir,
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
        const toolOutput = [result.stdout.trim(), result.stderr.trim()]
          .filter(Boolean)
          .join('\n');
        throw new Error(
          `No Java files were generated. Tool output: ${toolOutput.slice(0, 2000)}`,
        );
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
      if (path.dirname(path.resolve(jobWorkDir)) === path.resolve(os.tmpdir())) {
        await fs.promises
          .rm(jobWorkDir, { recursive: true, force: true })
          .catch((error: unknown) => {
            this.logger.warn(`Failed to clean up workspace ${jobWorkDir}: ${String(error)}`);
          });
      } else {
        this.logger.error('Refused to clean up an unsafe conversion workspace');
      }
    }
  }

  /**
   * Copies the uploaded bundle into the job workspace and rewrites EXEC CICS blocks (plus a
   * few other constructs) into the dialect tool2java can parse, adding stand-ins for the
   * IBM system copybooks (DFHAID, DFHBMSCA, EIB) next to every program. The stored upload
   * is never modified. If normalization itself fails, the original sources are used so the
   * job behaves exactly as before.
   */
  private async prepareSources(sourceDir: string, targetDir: string): Promise<string> {
    try {
      const relativePaths = await this.listFilesRecursive(sourceDir);
      const files = await Promise.all(
        relativePaths.map(async (relativePath) => ({
          name: relativePath,
          // latin1 round-trips every byte, so untouched content is copied unchanged.
          content: await fs.promises.readFile(path.join(sourceDir, relativePath), 'latin1'),
        })),
      );
      const normalized = normalizeBundle(files);

      const programDirs = new Set<string>();
      for (const file of files) {
        const target = path.join(targetDir, file.name);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(
          target,
          normalized.rewritten.get(file.name) ?? file.content,
          'latin1',
        );
        if (/\.(cbl|cob)$/i.test(file.name)) programDirs.add(path.dirname(target));
      }
      for (const dir of programDirs) {
        for (const [stubName, content] of normalized.stubs) {
          await fs.promises.writeFile(path.join(dir, stubName), content, 'latin1');
        }
      }

      const changeCount = [...normalized.changes.values()].reduce((n, list) => n + list.length, 0);
      if (changeCount > 0) {
        this.logger.log(
          `Normalized ${normalized.rewritten.size} source file(s) for tool2java (${changeCount} change(s); stubs: ${[...normalized.stubs.keys()].join(', ') || 'none'})`,
        );
      }
      return targetDir;
    } catch (error) {
      this.logger.warn(`Source normalization failed, using original sources: ${String(error)}`);
      return sourceDir;
    }
  }

  private async listFilesRecursive(root: string, prefix = ''): Promise<string[]> {
    const entries = await fs.promises.readdir(path.join(root, prefix), { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) result.push(...(await this.listFilesRecursive(root, relative)));
      else if (entry.isFile()) result.push(relative);
    }
    return result;
  }

  /** Flattens the unresolved entries (top-level and nested) of a dependency tree into
   * actionable messages — surfaced as the job's errorMessage. IBM system copybooks never
   * count, whether stored as SYSTEM_PROVIDED or (older analyses) as MISSING. */
  private collectBlockers(dependencies: DependencyEntry[]): string[] {
    const unresolved: string[] = [];
    const collect = (entries: DependencyEntry[]) => {
      for (const entry of entries) {
        const nonBlocking =
          entry.status === 'RESOLVED' ||
          entry.status === 'SYSTEM_PROVIDED' ||
          (entry.status === 'MISSING' && isSystemCopybook(entry.copyName));
        if (!nonBlocking) {
          unresolved.push(entry.message ?? `${entry.copyName}: ${entry.status}`);
        } else if (entry.dependencies) {
          collect(entry.dependencies);
        }
      }
    };
    collect(dependencies);
    return unresolved;
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
            reason:
              error.message.slice(0, 500) ||
              'tool2java could not translate this file — manual review required.',
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
