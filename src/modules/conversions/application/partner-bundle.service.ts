import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import { ConversionType, ProjectRecord } from '../../projects/domain/project.types';
import { SCREEN_REPOSITORY, ScreenRecord, ScreenRepository } from '../../screens/domain/screen.types';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRecord,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import {
  EXPORT_BUNDLE_REPOSITORY,
  ExcludedExportItem,
  ExportBundleRepository,
  ExportFileItem,
  PartnerBundleSummary,
  PartnerExportConfiguration,
} from '../domain/export.types';
import { ExportCodeService, ScreenExport } from './export-code.service';
import { buildSpringBootProjectTree } from './spring-boot-scaffold';

export interface PartnerBundleMetrics {
  totalFiles: number;
  /** Lines of real conversion output (scaffold files are not counted). */
  totalLoc: number;
  estimatedSizeKb: number;
}

export interface BuiltPartnerBundle {
  project: ProjectRecord;
  organizationId: string;
  packageName: string;
  summary: PartnerBundleSummary;
  metrics: PartnerBundleMetrics;
  fileTree: ExportFileItem[];
}

interface CollectedItem {
  screen: ScreenRecord;
  files: { relativePath: string; content: string }[];
}

const STATUS_REASONS: Partial<Record<ConversionJobStatus, string>> = {
  [ConversionJobStatus.QUEUED]: 'Conversion is still queued',
  [ConversionJobStatus.PROCESSING]: 'Conversion is still in progress',
  [ConversionJobStatus.CANCELLED]: 'Conversion was cancelled',
};

/**
 * Builds the runnable bundle a partner receives (UC-48): the real output of each selected
 * screen/program's latest COMPLETED conversion job, wrapped in a React 19 + Vite project
 * (BMS/DSPF) or a Spring Boot 3.3 project (COBOL). Anything without usable output is listed
 * in `excludedItems` with the reason, never replaced by sample code.
 */
@Injectable()
export class PartnerBundleService {
  private readonly logger = new Logger(PartnerBundleService.name);

  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(EXPORT_BUNDLE_REPOSITORY) private readonly bundles: ExportBundleRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
    private readonly exportCode: ExportCodeService,
  ) {}

  async build(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    config: Omit<PartnerExportConfiguration, 'projectId'>,
  ): Promise<BuiltPartnerBundle> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const project = await this.projects.getForOrganization(projectId, organization.id);
    const isJava = project.conversionType === ConversionType.COBOL_TO_JAVA;
    const projectName = config.projectName?.trim() || project.name;

    const [projectScreens, projectJobs, previousBundles] = await Promise.all([
      this.screens.listByProject(project.id, organization.id),
      this.jobs.listByProject(project.id, organization.id),
      this.bundles.listByProject(project.id, organization.id),
    ]);

    const excludedItems: ExcludedExportItem[] = [];
    const byId = new Map(projectScreens.map((s) => [s.id, s]));
    const requestedIds = config.selectedScreenIds.length
      ? [...new Set(config.selectedScreenIds)]
      : projectScreens.map((s) => s.id);

    const selected: ScreenRecord[] = [];
    for (const id of requestedIds) {
      const screen = byId.get(id);
      if (screen) selected.push(screen);
      else excludedItems.push({ name: id, reason: 'Not part of this project' });
    }

    const jobsByScreen = new Map<string, ConversionJobRecord[]>();
    for (const job of projectJobs) {
      if (!job.screenId) continue;
      const list = jobsByScreen.get(job.screenId) ?? [];
      list.push(job);
      jobsByScreen.set(job.screenId, list);
    }

    const collected: CollectedItem[] = [];
    for (const screen of selected) {
      const outcome = await this.collect(screen, jobsByScreen.get(screen.id) ?? [], isJava);
      if ('reason' in outcome) excludedItems.push({ name: screen.name, reason: outcome.reason });
      else collected.push(outcome);
    }

    const fileTree = isJava
      ? buildSpringBootProjectTree({
          projectName,
          programs: collected.map((c) => ({ name: c.screen.name, files: c.files })),
          excludedItems,
          includeUnitTests: config.includeUnitTests,
          includeDocumentation: config.includeDocumentation,
        })
      : this.exportCode.buildReactProjectTree(
          {
            projectId: project.id,
            projectName,
            outputOption: 'scaffold',
            frameworkTarget: 'react-19',
            stylingOption: 'tailwind',
            includeTypeScriptStrict: config.includeTypeScript,
            includeUnitTests: config.includeUnitTests,
            includeStorybook: false,
            includeDocumentation: config.includeDocumentation,
            selectedScreenIds: collected.map((c) => c.screen.id),
          },
          projectName,
          collected.map((c) => this.toScreenExport(c)),
        );

    if (config.includeDocumentation) {
      this.appendReleaseNotes(fileTree, projectName, collected, excludedItems, config.customNotes);
    }

    const generated = collected.flatMap((c) => c.files);
    return {
      project,
      organizationId: organization.id,
      packageName: this.packageName(projectName, previousBundles.length + 1),
      summary: {
        projectName,
        targetFramework: isJava ? 'Spring Boot 3.3' : 'React 19',
        screensIncluded: isJava ? 0 : collected.length,
        programsIncluded: isJava ? collected.length : 0,
        excludedItems,
      },
      metrics: {
        totalFiles: this.countFiles(fileTree),
        totalLoc: generated.reduce((sum, f) => sum + f.content.split('\n').length, 0),
        estimatedSizeKb: Math.round(
          generated.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0) / 1024,
        ),
      },
      fileTree,
    };
  }

  /** Rejects a bundle with nothing in it - there is no point sending a partner an empty project. */
  assertHasContent(bundle: BuiltPartnerBundle): void {
    const included = bundle.summary.screensIncluded + bundle.summary.programsIncluded;
    if (included === 0) {
      throw new UnprocessableEntityException({
        code: 'NO_COMPLETED_ITEMS',
        message: 'None of the selected screens or programs has a completed conversion to export',
        details: bundle.summary.excludedItems,
      });
    }
  }

  zip(bundle: BuiltPartnerBundle): Promise<Buffer> {
    return this.exportCode.zipFileTree(bundle.fileTree);
  }

  /** The tree without file contents, for previews. */
  outline(items: ExportFileItem[]): ExportFileItem[] {
    return items.map((item) => {
      const outlined: ExportFileItem = { ...item };
      delete outlined.content;
      if (item.children) outlined.children = this.outline(item.children);
      return outlined;
    });
  }

  private async collect(
    screen: ScreenRecord,
    jobs: ConversionJobRecord[],
    isJava: boolean,
  ): Promise<CollectedItem | { reason: string }> {
    const newestFirst = [...jobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latestCompleted = jobs
      .filter((job) => job.status === ConversionJobStatus.COMPLETED && job.resultReference)
      .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];

    if (!latestCompleted?.resultReference) {
      const latest = newestFirst[0];
      if (!latest) return { reason: 'Not converted yet' };
      if (latest.status === ConversionJobStatus.FAILED || latest.status === ConversionJobStatus.DEAD) {
        return {
          reason: latest.errorCode
            ? `Conversion failed (${latest.errorCode})`
            : 'Conversion failed',
        };
      }
      return { reason: STATUS_REASONS[latest.status] ?? `Conversion status is ${latest.status}` };
    }

    let stored: { relativePath: string; content: Buffer }[];
    try {
      stored = await this.storage.readFiles(latestCompleted.resultReference);
    } catch (error) {
      // The storage path stays in the server log only.
      this.logger.error(
        `Could not read conversion output of job ${latestCompleted.id}: ${(error as Error).message}`,
      );
      return { reason: 'Generated output could not be read' };
    }

    const extension = isJava ? '.java' : '.tsx';
    const files = stored
      .filter((f) => {
        const path = f.relativePath.toLowerCase();
        return path.endsWith(extension) && !path.endsWith('routes.tsx');
      })
      .map((f) => ({ relativePath: f.relativePath, content: f.content.toString('utf8') }));

    if (files.length === 0) {
      return { reason: `Conversion completed but produced no ${extension} files` };
    }
    return { screen, files };
  }

  private toScreenExport(item: CollectedItem): ScreenExport {
    return {
      screenId: item.screen.id,
      componentName: item.files[0].relativePath
        .replace(/\.(tsx)$/i, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .replace(/^[0-9]/, 'Comp'),
      files: item.files,
      language: 'typescript',
    };
  }

  private appendReleaseNotes(
    tree: ExportFileItem[],
    projectName: string,
    collected: CollectedItem[],
    excludedItems: ExcludedExportItem[],
    customNotes?: string,
  ): void {
    const root = tree[0]?.children ?? tree;
    const lines = [
      `# ${projectName} - Release Notes`,
      '',
      `Generated by ALSM on ${new Date().toISOString().slice(0, 10)}.`,
      '',
      '## Included',
      '',
      ...(collected.length ? collected.map((c) => `- ${c.screen.name}`) : ['- none']),
      '',
    ];
    if (excludedItems.length) {
      lines.push('## Excluded', '', ...excludedItems.map((i) => `- ${i.name}: ${i.reason}`), '');
    }
    const notes = customNotes?.trim();
    if (notes) lines.push('## Notes from the conversion team', '', notes, '');
    const content = lines.join('\n');
    root.push({
      path: 'RELEASE_NOTES.md',
      name: 'RELEASE_NOTES.md',
      size: `${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)} KB`,
      type: 'file',
      language: 'markdown',
      content,
    });
  }

  private packageName(projectName: string, version: number): string {
    const slug = projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${slug || 'project'}-modernized-bundle-v${version}.zip`;
  }

  private countFiles(items: ExportFileItem[]): number {
    return items.reduce(
      (sum, item) => sum + (item.type === 'file' ? 1 : this.countFiles(item.children ?? [])),
      0,
    );
  }
}
