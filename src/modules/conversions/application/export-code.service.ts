import { Inject, Injectable } from '@nestjs/common';
import type JSZipType from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof JSZipType;
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import type { ExportConfiguration, ExportFileItem, BundleMetrics } from '../domain/export.types';

interface ScreenExport {
  screenId: string;
  componentName: string;
  files: { relativePath: string; content: string }[];
}

@Injectable()
export class ExportCodeService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
  ) {}

  /**
   * Generates file tree structure preview and bundle metrics for backend REST API,
   * sourced from real completed conversion job output (not sample/placeholder code).
   */
  async generateExportPreview(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    config: ExportConfiguration,
  ): Promise<{ fileTree: ExportFileItem[]; metrics: BundleMetrics }> {
    const { screens } = await this.loadScreenExports(userId, organizationHeader, projectId, config);
    const projectName = config.projectName || 'Modernized System';
    const fileTree = this.buildFileTree(config, projectName, screens);
    const metrics = this.calculateMetrics(screens);
    return { fileTree, metrics };
  }

  /**
   * Generates a compressed zip file buffer containing the real generated code artifacts
   * for every selected screen that has a completed conversion job.
   */
  async generateZipBuffer(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    config: ExportConfiguration,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { screens } = await this.loadScreenExports(userId, organizationHeader, projectId, config);
    const zip = new JSZip();
    const projectName = config.projectName || 'Modernized System';
    const tree = this.buildFileTree(config, projectName, screens);

    const addItemsToZip = (items: ExportFileItem[], currentFolder: JSZipType) => {
      for (const item of items) {
        if (item.type === 'dir') {
          const subFolder = currentFolder.folder(item.name);
          if (subFolder && item.children) {
            addItemsToZip(item.children, subFolder);
          }
        } else if (item.content !== undefined) {
          currentFolder.file(item.name, item.content);
        }
      }
    };

    if (tree[0] && tree[0].children) {
      addItemsToZip(tree[0].children, zip);
    } else {
      addItemsToZip(tree, zip);
    }

    const arrayBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    const safeName = projectName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const filename = `${safeName}-export-code.zip`;

    return { buffer: arrayBuffer, filename };
  }

  /** Resolves each selected screen to the real files from its latest COMPLETED conversion job. Screens with no completed job yet are kept (with an empty files list) rather than failing the whole export — the caller surfaces this as a warning, never as fake generated code. */
  private async loadScreenExports(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    config: ExportConfiguration,
  ): Promise<{ screens: ScreenExport[] }> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);

    const screens: ScreenExport[] = [];
    for (const screenId of config.selectedScreenIds) {
      const jobsForScreen = await this.jobs.listByScreen(projectId, screenId, organization.id);
      const latestCompleted = jobsForScreen
        .filter((job) => job.status === ConversionJobStatus.COMPLETED && job.resultReference)
        .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];

      if (!latestCompleted?.resultReference) {
        screens.push({ screenId, componentName: this.getComponentName(screenId), files: [] });
        continue;
      }

      const stored = await this.storage.readFiles(latestCompleted.resultReference);
      const componentFiles = stored
        .filter(
          (f) =>
            f.relativePath.toLowerCase().endsWith('.tsx') &&
            !f.relativePath.toLowerCase().endsWith('routes.tsx'),
        )
        .map((f) => ({ relativePath: f.relativePath, content: f.content.toString('utf8') }));

      screens.push({
        screenId,
        componentName: this.getComponentName(componentFiles[0]?.relativePath ?? screenId),
        files: componentFiles,
      });
    }
    return { screens };
  }

  private buildFileTree(
    config: ExportConfiguration,
    projectName: string,
    screens: ScreenExport[],
  ): ExportFileItem[] {
    const safeProjectName = projectName.toLowerCase().replace(/\s+/g, '-');
    const convertedScreens = screens.filter((s) => s.files.length > 0);
    const missingScreens = screens.filter((s) => s.files.length === 0);

    const componentFiles: ExportFileItem[] = [];
    for (const screen of convertedScreens) {
      for (const file of screen.files) {
        componentFiles.push({
          path: `components/${file.relativePath}`,
          name: file.relativePath,
          size: `${(Buffer.byteLength(file.content, 'utf8') / 1024).toFixed(1)} KB`,
          type: 'file',
          language: 'typescript',
          content: file.content,
        });
      }
      if (config.includeUnitTests) {
        componentFiles.push({
          path: `components/${screen.componentName}.test.tsx`,
          name: `${screen.componentName}.test.tsx`,
          size: '1.9 KB',
          type: 'file',
          language: 'typescript',
          content: this.getUnitTestContent(screen.componentName),
        });
      }
    }
    componentFiles.push({
      path: 'components/index.ts',
      name: 'index.ts',
      size: '0.4 KB',
      type: 'file',
      language: 'typescript',
      content: convertedScreens.map((s) => `export * from './${s.componentName}';`).join('\n'),
    });

    const rootChildren: ExportFileItem[] = [
      {
        path: 'components',
        name: 'components',
        size: `${componentFiles.length} files`,
        type: 'dir',
        children: componentFiles,
      },
    ];

    if (config.includeDocumentation) {
      rootChildren.push({
        path: 'README.md',
        name: 'README.md',
        size: '1.2 KB',
        type: 'file',
        language: 'markdown',
        content: this.getReadmeContent(config, projectName, convertedScreens, missingScreens),
      });
    }

    if (config.outputOption === 'standalone') {
      return [
        {
          path: 'export-bundle',
          name: `${safeProjectName}-components`,
          size: 'Root',
          type: 'dir',
          children: rootChildren,
        },
      ];
    }

    rootChildren.push({
      path: 'package.json',
      name: 'package.json',
      size: '1.2 KB',
      type: 'file',
      language: 'json',
      content: JSON.stringify(
        {
          name: `${safeProjectName}-app`,
          private: true,
          version: '1.0.0',
          type: 'module',
          scripts: { dev: 'vite', build: 'tsc -b && vite build' },
          dependencies: {
            react: config.frameworkTarget === 'react-19' ? '^19.2.0' : '^18.3.1',
            'react-dom': config.frameworkTarget === 'react-19' ? '^19.2.0' : '^18.3.1',
          },
        },
        null,
        2,
      ),
    });

    return [
      {
        path: 'project-root',
        name: `${safeProjectName}-app`,
        size: 'Root',
        type: 'dir',
        children: [
          {
            path: 'src',
            name: 'src',
            size: 'Source directory',
            type: 'dir',
            children: [
              {
                path: 'src/components',
                name: 'components',
                size: `${componentFiles.length} files`,
                type: 'dir',
                children: componentFiles,
              },
            ],
          },
          ...rootChildren.filter((c) => c.path !== 'components'),
        ],
      },
    ];
  }

  private calculateMetrics(screens: ScreenExport[]): BundleMetrics {
    const convertedScreens = screens.filter((s) => s.files.length > 0);
    const allFiles = convertedScreens.flatMap((s) => s.files);
    const totalFiles = allFiles.length + 2; // + index.ts + README.md
    const totalLoc = allFiles.reduce((sum, f) => sum + f.content.split('\n').length, 0);
    const estimatedSizeKb = Math.round(
      allFiles.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0) / 1024,
    );

    return {
      totalFiles,
      totalLoc,
      estimatedSizeKb,
      selectedScreensCount: convertedScreens.length,
    };
  }

  private getComponentName(rawName: string): string {
    return rawName
      .replace(/\.(bms|dspf|tsx|java)$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[0-9]/, 'Comp');
  }

  private getUnitTestContent(compName: string): string {
    return `import { render, screen } from '@testing-library/react';\nimport { ${compName} } from './${compName}';\n\ndescribe('${compName}', () => {\n  it('renders correctly', () => {\n    render(<${compName} />);\n    expect(screen.getByText('${compName}')).toBeInTheDocument();\n  });\n});\n`;
  }

  private getReadmeContent(
    config: ExportConfiguration,
    projectName: string,
    convertedScreens: ScreenExport[],
    missingScreens: ScreenExport[],
  ): string {
    const missingNote = missingScreens.length
      ? `\n## Not Included\nThe following screens have no completed conversion job yet and were skipped (no placeholder code was generated): ${missingScreens
          .map((s) => s.screenId)
          .join(', ')}.\n`
      : '';
    return `# ${projectName} - Modernized Export Package\n\nGenerated automatically by **ALSM Platform Backend Engine** from real conversion job output.\n\n## Configuration\n- Target Framework: ${config.frameworkTarget}\n- Output Option: ${config.outputOption}\n- Styling: ${config.stylingOption}\n- Converted Screens: ${convertedScreens.map((s) => s.screenId).join(', ') || 'none'}\n${missingNote}`;
  }
}
