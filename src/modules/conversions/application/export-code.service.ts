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
  language: 'typescript' | 'java';
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
    const metrics = this.calculateMetrics(screens, fileTree);
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
        screens.push({
          screenId,
          componentName: this.getComponentName(screenId),
          files: [],
          language: 'typescript',
        });
        continue;
      }

      // toolVersion tells us which conversion engine produced this job's output:
      // 'tool2java' (COBOL->Java) writes .java files, everything else (convert2fe,
      // BMS/DSPF->React) writes .tsx files. Without this branch, COBOL jobs' real
      // output was always filtered out by the .tsx-only check below.
      const isJavaJob = latestCompleted.toolVersion === 'tool2java';
      const stored = await this.storage.readFiles(latestCompleted.resultReference);
      const files = isJavaJob
        ? stored
            .filter((f) => f.relativePath.toLowerCase().endsWith('.java'))
            .map((f) => ({ relativePath: f.relativePath, content: f.content.toString('utf8') }))
        : stored
            .filter(
              (f) =>
                f.relativePath.toLowerCase().endsWith('.tsx') &&
                !f.relativePath.toLowerCase().endsWith('routes.tsx'),
            )
            .map((f) => ({ relativePath: f.relativePath, content: f.content.toString('utf8') }));

      screens.push({
        screenId,
        componentName: this.getComponentName(files[0]?.relativePath ?? screenId),
        files,
        language: isJavaJob ? 'java' : 'typescript',
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
    const reactScreens = convertedScreens.filter((s) => s.language !== 'java');
    const javaScreens = convertedScreens.filter((s) => s.language === 'java');

    const componentFiles: ExportFileItem[] = [];
    for (const screen of reactScreens) {
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
      content: reactScreens.map((s) => `export * from './${s.componentName}';`).join('\n'),
    });

    // Real generated Java source, preserving the package folder structure tool2java
    // already produced (e.g. cobolprogramclasses/cbact01c/Cbact01cTasklet.java). No
    // fabricated build scaffold (pom.xml, JUnit tests) is added - only real output.
    const javaFiles: ExportFileItem[] = [];
    for (const screen of javaScreens) {
      for (const file of screen.files) {
        javaFiles.push({
          path: `java/${file.relativePath}`,
          name: file.relativePath,
          size: `${(Buffer.byteLength(file.content, 'utf8') / 1024).toFixed(1)} KB`,
          type: 'file',
          language: 'java',
          content: file.content,
        });
      }
    }

    // The React scaffold (components/, package.json, the Vite src/ layout below) only
    // makes sense when there is real React output. A project made up entirely of
    // COBOL->Java screens gets a plain source tree instead of an empty React app shell.
    const includeReactScaffold = reactScreens.length > 0 || javaScreens.length === 0;

    const rootChildren: ExportFileItem[] = [];
    if (includeReactScaffold) {
      rootChildren.push({
        path: 'components',
        name: 'components',
        size: `${componentFiles.length} files`,
        type: 'dir',
        children: componentFiles,
      });
    }
    if (javaScreens.length > 0) {
      rootChildren.push({
        path: 'java',
        name: 'java',
        size: `${javaFiles.length} files`,
        type: 'dir',
        children: javaFiles,
      });
    }

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

    // The Vite/React project scaffold below is meaningless without any React output -
    // fall back to the flat source tree used by 'standalone' in that case too.
    if (config.outputOption === 'standalone' || !includeReactScaffold) {
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

    // `stylingOption: 'css-modules'` is accepted by the config but has no effect today:
    // bms2react.py (the actual BMS/DSPF->React generator) hardcodes Tailwind utility
    // classNames directly into every generated component's JSX. Omitting the Tailwind
    // setup here when 'css-modules' is selected would leave every real converted screen
    // completely unstyled, which is strictly worse than including a config the project
    // happens not to need - so Tailwind is always wired up for a React scaffold until
    // the generator itself supports an alternative styling output.
    rootChildren.push(
      {
        path: 'index.html',
        name: 'index.html',
        size: '0.4 KB',
        type: 'file',
        language: 'html',
        content: this.getIndexHtmlContent(projectName),
      },
      {
        path: 'package.json',
        name: 'package.json',
        size: '1.2 KB',
        type: 'file',
        language: 'json',
        content: this.getPackageJsonContent(config, safeProjectName),
      },
      {
        path: 'tsconfig.json',
        name: 'tsconfig.json',
        size: '0.6 KB',
        type: 'file',
        language: 'json',
        content: this.getTsConfigContent(config.includeTypeScriptStrict),
      },
      {
        path: 'tsconfig.node.json',
        name: 'tsconfig.node.json',
        size: '0.3 KB',
        type: 'file',
        language: 'json',
        content: this.getTsConfigNodeContent(),
      },
      {
        path: 'vite.config.ts',
        name: 'vite.config.ts',
        size: '0.2 KB',
        type: 'file',
        language: 'typescript',
        // `test.environment: 'jsdom'` is required or `npm run test` fails every
        // generated screen with "document is not defined" (vitest defaults to the
        // 'node' environment, which has no DOM) - confirmed by actually running the
        // generated test suite, not assumed.
        content: config.includeUnitTests
          ? `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    port: 3000,\n  },\n  test: {\n    environment: 'jsdom',\n  },\n});\n`
          : `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    port: 3000,\n  },\n});\n`,
      },
      {
        path: 'tailwind.config.js',
        name: 'tailwind.config.js',
        size: '0.3 KB',
        type: 'file',
        language: 'javascript',
        content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./index.html', './src/**/*.{ts,tsx}'],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n};\n`,
      },
      {
        path: 'postcss.config.js',
        name: 'postcss.config.js',
        size: '0.1 KB',
        type: 'file',
        language: 'javascript',
        content: `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
      },
      {
        path: '.env.example',
        name: '.env.example',
        size: '0.1 KB',
        type: 'file',
        content: `# Base URL of the ALSM backend this converted app talks to.\nVITE_API_BASE_URL=http://localhost:3000/api/v1\n`,
      },
      {
        path: '.gitignore',
        name: '.gitignore',
        size: '0.2 KB',
        type: 'file',
        content: `node_modules\ndist\ndist-ssr\n*.local\n\n.env\n.env.*\n!.env.example\n\n.vscode/*\n!.vscode/extensions.json\n.idea\n.DS_Store\n`,
      },
    );

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
              {
                path: 'src/services',
                name: 'services',
                size: '1 file',
                type: 'dir',
                children: [
                  {
                    path: 'src/services/api.ts',
                    name: 'api.ts',
                    size: '0.4 KB',
                    type: 'file',
                    language: 'typescript',
                    content: this.getApiServiceContent(),
                  },
                ],
              },
              {
                path: 'src/App.tsx',
                name: 'App.tsx',
                size: '1.5 KB',
                type: 'file',
                language: 'typescript',
                content: this.getAppTsxContent(reactScreens),
              },
              {
                path: 'src/main.tsx',
                name: 'main.tsx',
                size: '0.3 KB',
                type: 'file',
                language: 'typescript',
                content: `import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n`,
              },
              {
                path: 'src/index.css',
                name: 'index.css',
                size: '0.2 KB',
                type: 'file',
                language: 'css',
                content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nbody {\n  margin: 0;\n  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;\n}\n`,
              },
            ],
          },
          ...rootChildren.filter((c) => c.path !== 'components'),
        ],
      },
    ];
  }

  private getIndexHtmlContent(projectName: string): string {
    return `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>${projectName}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`;
  }

  private getTsConfigContent(strict: boolean): string {
    return JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          useDefineForClassFields: true,
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          // Without this, tsc has no declarations for `import.meta.env` (used by every
          // generated screen and src/services/api.ts) or for importing a .css file -
          // both fail to compile otherwise.
          types: ['vite/client'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noFallthroughCasesInSwitch: true,
        },
        include: ['src'],
      },
      null,
      2,
    );
  }

  private getTsConfigNodeContent(): string {
    return JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          noEmit: true,
        },
        include: ['vite.config.ts'],
      },
      null,
      2,
    );
  }

  private getApiServiceContent(): string {
    return `import axios from 'axios';\n\n// Converted screens currently call the backend directly with this same base URL\n// (see each component's VITE_API_BASE_URL usage). This client is provided as a\n// shared starting point for any new code added to this app; it is not yet wired\n// into the generated screen components themselves.\nexport const apiClient = axios.create({\n  baseURL: import.meta.env.VITE_API_BASE_URL || '',\n});\n\napiClient.interceptors.response.use(\n  (response) => response,\n  (error) => {\n    const message = error?.response?.data?.message || error?.message || 'Request failed';\n    return Promise.reject(new Error(message));\n  },\n);\n`;
  }

  private getAppTsxContent(reactScreens: ScreenExport[]): string {
    const imports = reactScreens
      .map((s) => `import { ${s.componentName} } from './components/${s.componentName}';`)
      .join('\n');
    const routes = reactScreens
      .map((s) => `        <Route path="/${s.componentName}" element={<${s.componentName} />} />`)
      .join('\n');
    const navLinks = reactScreens
      .map((s) => `          <li><Link to="/${s.componentName}">${s.componentName}</Link></li>`)
      .join('\n');

    return `import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';\n${imports}\n\nfunction Home() {\n  return (\n    <div style={{ padding: 24 }}>\n      <h1>Converted Screens</h1>\n      <ul>\n${navLinks}\n      </ul>\n    </div>\n  );\n}\n\nfunction NotFound() {\n  return (\n    <div style={{ padding: 24 }}>\n      <h2>Page not found</h2>\n      <p>This screen does not exist in the converted application.</p>\n      <Link to="/">Back to home</Link>\n    </div>\n  );\n}\n\nexport function App() {\n  return (\n    <BrowserRouter>\n      <Routes>\n        <Route path="/" element={<Home />} />\n${routes}\n        <Route path="*" element={<NotFound />} />\n      </Routes>\n    </BrowserRouter>\n  );\n}\n\nexport default App;\n`;
  }

  private getPackageJsonContent(config: ExportConfiguration, safeProjectName: string): string {
    const isReact19 = config.frameworkTarget === 'react-19';
    return JSON.stringify(
      {
        name: `${safeProjectName}-app`,
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
          ...(config.includeUnitTests ? { test: 'vitest run' } : {}),
        },
        dependencies: {
          react: isReact19 ? '^19.2.8' : '^18.3.1',
          'react-dom': isReact19 ? '^19.2.8' : '^18.3.1',
          'react-router-dom': '^7.18.2',
          axios: '^1.20.0',
        },
        devDependencies: {
          '@types/react': isReact19 ? '^19.2.17' : '^18.3.3',
          '@types/react-dom': isReact19 ? '^19.2.3' : '^18.3.3',
          '@vitejs/plugin-react': '^6.0.4',
          typescript: '~6.0.2',
          vite: '^8.2.0',
          tailwindcss: '^3.4.19',
          autoprefixer: '^10.5.4',
          postcss: '^8.5.26',
          ...(config.includeUnitTests
            ? {
                vitest: '^4.1.11',
                jsdom: '^29.1.1',
                '@testing-library/react': '^16.3.3',
                '@testing-library/jest-dom': '^7.0.1',
              }
            : {}),
        },
      },
      null,
      2,
    );
  }

  private calculateMetrics(screens: ScreenExport[], fileTree: ExportFileItem[]): BundleMetrics {
    const convertedScreens = screens.filter((s) => s.files.length > 0);
    const allFiles = convertedScreens.flatMap((s) => s.files);
    // Counted from the actual generated tree rather than a fixed "+2" (index.ts and
    // README.md aren't always both present - e.g. a Java-only export has no index.ts,
    // and README.md is itself conditional on config.includeDocumentation).
    const totalFiles = this.countFiles(fileTree);
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

  private countFiles(items: ExportFileItem[]): number {
    let count = 0;
    for (const item of items) {
      if (item.type === 'file') {
        count += 1;
      } else if (item.children) {
        count += this.countFiles(item.children);
      }
    }
    return count;
  }

  private getComponentName(rawName: string): string {
    return rawName
      .replace(/\.(bms|dspf|tsx|java)$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .replace(/^[0-9]/, 'Comp');
  }

  private getUnitTestContent(compName: string): string {
    // Every generated screen calls useNavigate() internally, so it must render inside a
    // Router or React throws immediately. The assertion only checks that the component
    // renders without crashing (container has content) rather than asserting the literal
    // component name is visible text - real converted screens never render their own
    // class name, they render BMS field labels/values, which this generic test has no
    // way to know in advance.
    return `import { describe, it, expect } from 'vitest';\nimport { render } from '@testing-library/react';\nimport { MemoryRouter } from 'react-router-dom';\nimport { ${compName} } from './${compName}';\n\ndescribe('${compName}', () => {\n  it('renders without crashing', () => {\n    const { container } = render(<${compName} />, { wrapper: MemoryRouter });\n    expect(container.firstChild).toBeTruthy();\n  });\n});\n`;
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

    const reactScreens = convertedScreens.filter((s) => s.language !== 'java');
    const javaScreens = convertedScreens.filter((s) => s.language === 'java');
    const isReactScaffold = config.outputOption !== 'standalone' && reactScreens.length > 0;

    if (!isReactScaffold) {
      // Java-only or standalone exports: a flat source tree, no app to run.
      return `# ${projectName} - Modernized Export Package\n\nGenerated automatically by **ALSM Platform Backend Engine** from real conversion job output.\n\n## Configuration\n- Target Framework: ${config.frameworkTarget}\n- Output Option: ${config.outputOption}\n- Styling: ${config.stylingOption}\n- Converted Screens: ${convertedScreens.map((s) => s.screenId).join(', ') || 'none'}\n${missingNote}\n${
        javaScreens.length > 0
          ? `\n## Java Output\nThis package contains real COBOL -> Java source generated by tool2java (${javaScreens.length} program(s)) under \`java/\`. No build scaffold (pom.xml, JUnit) is included - this is source-only output; wire it into your own Java build as needed.\n`
          : `\n## Components Only\nThis is a flat component bundle (\`outputOption: standalone\`), not a runnable app. Copy \`components/\` into an existing React + TypeScript + Vite project (the components use Tailwind utility classNames and call \`axios\` directly against \`VITE_API_BASE_URL\`).\n`
      }`;
    }

    const screenList = reactScreens.map((s) => `\`/${s.componentName}\``).join(', ');

    return `# ${projectName}

Modernized React/TypeScript app generated automatically by **ALSM (Automating Legacy System Modernization Platform)** from real BMS/DSPF conversion job output. Nothing in \`src/components/\` is a placeholder - each \`.tsx\` file is the real converted screen for the legacy program of the same name.

**Converted screens:** ${screenList || 'none'}
${missingNote}
## Requirements

- Node.js 18 or newer
- npm 9 or newer

## Install

\`\`\`bash
npm install
\`\`\`

## Run in development

\`\`\`bash
npm run dev
\`\`\`

Open the local address Vite prints in the terminal (typically http://localhost:3000).

## Build for production

\`\`\`bash
npm run build
\`\`\`

## Preview the production build

\`\`\`bash
npm run preview
\`\`\`
${
  config.includeUnitTests
    ? `\n## Run tests\n\n\`\`\`bash\nnpm run test\n\`\`\`\n\nEach screen ships with a smoke test that renders it inside a router and asserts it mounts without crashing. These tests do not assert field-level behavior - verify that by hand against the original BMS map before trusting a screen in production.\n`
    : ''
}
## Project structure

\`\`\`text
index.html          Vite entry HTML
src/main.tsx         React root bootstrap
src/App.tsx          Routes to every converted screen (one route per screen name)
src/index.css        Tailwind entry stylesheet
src/services/api.ts   Shared axios client reading VITE_API_BASE_URL (not yet wired into the
                     generated screens below - each one builds its own axios call already
                     scoped to VITE_API_BASE_URL)
src/components/      One .tsx (+ .test.tsx) per converted screen, plus index.ts re-exporting all of them
\`\`\`

## Backend / API configuration

Each screen calls \`POST {VITE_API_BASE_URL}/api/<SCREEN_NAME>\` with the current form fields and expects back \`{ fields, errmsg?, nextScreen? }\`. Copy \`.env.example\` to \`.env\` and set:

\`\`\`bash
VITE_API_BASE_URL=http://localhost:3000/api/v1
\`\`\`

to point at your real backend. **If that backend is not implemented yet**, the app still starts and every screen still renders - submitting a form will just show a request-failed error until the matching endpoint exists.

## Troubleshooting

- **"Cannot find module" / blank page on \`npm run dev\`**: run \`npm install\` again; delete \`node_modules\` and reinstall if it persists.
- **TypeScript errors on \`npm run build\`**: run \`npx tsc -b\` directly to see the full list; this package was generated with \`strict: ${config.includeTypeScriptStrict}\`.
- **"Port 3000 is already in use"**: another process is using it - stop it, or pass \`--port <n>\` to \`npm run dev\`.
- **A submit button does nothing / shows a request error**: the backend endpoint for that screen isn't reachable yet - confirm \`VITE_API_BASE_URL\` in \`.env\` and that the backend is running.
- **Build succeeds but a screen looks unstyled**: Tailwind's \`content\` glob in \`tailwind.config.js\` only scans \`src/**/*.{ts,tsx}\` - if you move components outside \`src/\`, update that glob.
${
  javaScreens.length > 0
    ? `\n## Java Output\nThis export also includes real COBOL -> Java source under \`java/\` (${javaScreens.length} program(s)), generated by tool2java and kept separate from the React app above - it is source-only, with no build scaffold.\n`
    : ''
}`;
  }
}
