import { Inject, Injectable, Logger } from '@nestjs/common';
import { SCREEN_REPOSITORY, ScreenRepository } from '../../screens/domain/screen.types';
import type { ConversionEngineInput } from '../domain/conversion-job.types';
import { SUPPORT_PATCH_REPOSITORY, SupportPatchRepository } from '../domain/support-patch.types';
import { applyBmsSupportPatch } from './bms-support-patch.util';

export interface GeneratedFile {
  relativePath: string;
  content: Buffer;
}

export const SUPPORT_PATCH_REPORT_FILE = 'support-patch-report.json';

/**
 * Applies the latest support patch of a conversion job to the files a BMS/DSPF engine run
 * produced, so re-running a patched job really changes the generated screen. A report of
 * what was applied or skipped is added to the result next to the generated code.
 */
@Injectable()
export class SupportPatchApplier {
  private readonly logger = new Logger(SupportPatchApplier.name);

  constructor(
    @Inject(SUPPORT_PATCH_REPOSITORY) private readonly patches: SupportPatchRepository,
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
  ) {}

  async applyToScreenOutput(input: ConversionEngineInput, files: GeneratedFile[]): Promise<GeneratedFile[]> {
    const [patch] = await this.patches.listByJob(input.conversionJobId, input.organizationId);
    if (!patch || patch.rules.length === 0) return files;

    // The engine converts the whole uploaded bundle; the patch belongs to this job's screen only.
    const screen = input.screenId ? await this.screens.findById(input.screenId, input.organizationId) : null;
    const baseName = screen?.name.replace(/\.[^.]+$/, '').toLowerCase();
    const target = baseName
      ? files.find((f) => f.relativePath.toLowerCase() === `${baseName}.tsx`)
      : undefined;

    const report: Record<string, unknown> = {
      patchId: patch.id,
      appliedAt: new Date().toISOString(),
      screen: screen?.name ?? null,
      file: target?.relativePath ?? null,
    };
    let result = files;
    if (!target) {
      report.applied = [];
      report.skipped = patch.rules.map((r) => ({
        sourceField: r.sourceField,
        reason: 'The generated component for this job\'s screen was not found',
      }));
    } else {
      const outcome = applyBmsSupportPatch(target.content.toString('utf8'), patch.rules);
      report.applied = outcome.applied;
      report.skipped = outcome.skipped;
      result = files.map((f) => (f === target ? { ...f, content: Buffer.from(outcome.content, 'utf8') } : f));
    }
    this.logger.log(
      `Support patch ${patch.id} on job ${input.conversionJobId}: ${(report.applied as unknown[]).length} applied, ${(report.skipped as unknown[]).length} skipped`,
    );
    return [
      ...result.filter((f) => f.relativePath !== SUPPORT_PATCH_REPORT_FILE),
      { relativePath: SUPPORT_PATCH_REPORT_FILE, content: Buffer.from(JSON.stringify(report, null, 2), 'utf8') },
    ];
  }
}
