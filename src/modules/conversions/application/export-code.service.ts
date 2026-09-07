import { Injectable } from '@nestjs/common';
import type JSZipType from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof JSZipType;
import type {
  ExportConfiguration,
  ExportFileItem,
  BundleMetrics,
} from '../domain/export.types';

@Injectable()
export class ExportCodeService {
  /**
   * Generates file tree structure preview and bundle metrics for backend REST API
   */
  async generateExportPreview(
    projectId: string,
    config: ExportConfiguration,
  ): Promise<{ fileTree: ExportFileItem[]; metrics: BundleMetrics }> {
    const projectName = config.projectName || 'Modernized System';
    const screens = config.selectedScreenIds.map((id) => ({
      id,
      name: id.includes('login')
        ? 'LoginScreen.bms'
        : `${id.charAt(0).toUpperCase() + id.slice(1)}Screen.bms`,
    }));

    const fileTree = this.buildFileTree(config, projectName, screens);
    const metrics = this.calculateMetrics(config, screens.length);

    return { fileTree, metrics };
  }

  /**
   * Generates a compressed zip file buffer containing all exported code artifacts
   */
  async generateZipBuffer(
    projectId: string,
    config: ExportConfiguration,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const zip = new JSZip();
    const projectName = config.projectName || 'Modernized System';
    const screens = config.selectedScreenIds.map((id) => ({
      id,
      name: id.includes('login')
        ? 'LoginScreen.bms'
        : `${id.charAt(0).toUpperCase() + id.slice(1)}Screen.bms`,
    }));

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

  private buildFileTree(
    config: ExportConfiguration,
    projectName: string,
    screens: { id: string; name: string }[],
  ): ExportFileItem[] {
    const safeProjectName = projectName.toLowerCase().replace(/\s+/g, '-');

    if (config.outputOption === 'standalone') {
      const componentFiles: ExportFileItem[] = screens.map((s) => ({
        path: `components/${this.getComponentName(s.name)}.tsx`,
        name: `${this.getComponentName(s.name)}.tsx`,
        size: '3.8 KB',
        type: 'file',
        language: 'typescript',
        content: this.getScreenTsxContent(s.name),
      }));

      if (config.includeUnitTests) {
        screens.forEach((s) => {
          componentFiles.push({
            path: `components/${this.getComponentName(s.name)}.test.tsx`,
            name: `${this.getComponentName(s.name)}.test.tsx`,
            size: '1.9 KB',
            type: 'file',
            language: 'typescript',
            content: this.getUnitTestContent(s.name),
          });
        });
      }

      componentFiles.push({
        path: 'components/index.ts',
        name: 'index.ts',
        size: '0.4 KB',
        type: 'file',
        language: 'typescript',
        content: screens
          .map((s) => `export * from './${this.getComponentName(s.name)}';`)
          .join('\n'),
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
          content: this.getReadmeContent(config, projectName, screens),
        });
      }

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

    // Scaffold Project Layout
    const srcComponents: ExportFileItem[] = screens.map((s) => ({
      path: `src/components/${this.getComponentName(s.name)}.tsx`,
      name: `${this.getComponentName(s.name)}.tsx`,
      size: '3.8 KB',
      type: 'file',
      language: 'typescript',
      content: this.getScreenTsxContent(s.name),
    }));

    if (config.includeUnitTests) {
      screens.forEach((s) => {
        srcComponents.push({
          path: `src/components/${this.getComponentName(s.name)}.test.tsx`,
          name: `${this.getComponentName(s.name)}.test.tsx`,
          size: '1.9 KB',
          type: 'file',
          language: 'typescript',
          content: this.getUnitTestContent(s.name),
        });
      });
    }

    srcComponents.push({
      path: 'src/components/index.ts',
      name: 'index.ts',
      size: '0.5 KB',
      type: 'file',
      language: 'typescript',
      content: screens
        .map((s) => `export * from './${this.getComponentName(s.name)}';`)
        .join('\n'),
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
                size: `${srcComponents.length} files`,
                type: 'dir',
                children: srcComponents,
              },
            ],
          },
          {
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
                scripts: {
                  dev: 'vite',
                  build: 'tsc -b && vite build',
                },
                dependencies: {
                  react: config.frameworkTarget === 'react-19' ? '^19.2.0' : '^18.3.1',
                  'react-dom': config.frameworkTarget === 'react-19' ? '^19.2.0' : '^18.3.1',
                },
              },
              null,
              2,
            ),
          },
          {
            path: 'README.md',
            name: 'README.md',
            size: '1.8 KB',
            type: 'file',
            language: 'markdown',
            content: this.getReadmeContent(config, projectName, screens),
          },
        ],
      },
    ];
  }

  private calculateMetrics(
    config: ExportConfiguration,
    screensCount: number,
  ): BundleMetrics {
    const totalFiles = screensCount * 2 + 6;
    const estimatedSizeKb = Math.round(totalFiles * 4.5 + 40);
    const totalLoc = screensCount * 350 + 180;

    return {
      totalFiles,
      totalLoc,
      estimatedSizeKb,
      selectedScreensCount: screensCount,
    };
  }

  private getComponentName(rawName: string): string {
    return rawName
      .replace(/\.(bms|dspf)$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[0-9]/, 'Comp');
  }

  private getScreenTsxContent(rawName: string): string {
    const compName = this.getComponentName(rawName);
    return `import React from 'react';\n\nexport const ${compName}: React.FC = () => {\n  return (\n    <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">\n      <h2 className="text-xl font-bold text-slate-900">${compName}</h2>\n      <p className="text-xs text-slate-500 mt-1">Generated React component by ALSM Backend Engine</p>\n    </div>\n  );\n};\nexport default ${compName};\n`;
  }

  private getUnitTestContent(rawName: string): string {
    const compName = this.getComponentName(rawName);
    return `import { render, screen } from '@testing-library/react';\nimport { ${compName} } from './${compName}';\n\ndescribe('${compName}', () => {\n  it('renders correctly', () => {\n    render(<${compName} />);\n    expect(screen.getByText('${compName}')).toBeInTheDocument();\n  });\n});\n`;
  }

  private getReadmeContent(
    config: ExportConfiguration,
    projectName: string,
    screens: { id: string; name: string }[],
  ): string {
    return `# ${projectName} - Modernized Export Package\n\nGenerated automatically by **ALSM Platform Backend Engine**.\n\n## Configuration\n- Target Framework: ${config.frameworkTarget}\n- Output Option: ${config.outputOption}\n- Styling: ${config.stylingOption}\n- Selected Screens: ${screens.map((s) => s.name).join(', ')}\n`;
  }
}
