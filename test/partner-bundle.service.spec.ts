import type JSZipType from 'jszip';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip') as typeof JSZipType;
import { UnprocessableEntityException } from '@nestjs/common';
import { ExportCodeService } from '../src/modules/conversions/application/export-code.service';
import { PartnerBundleService } from '../src/modules/conversions/application/partner-bundle.service';
import { findExternalImports } from '../src/modules/conversions/application/spring-boot-scaffold';
import { ConversionJobStatus } from '../src/modules/conversions/domain/conversion-job.types';
import type { ExportFileItem } from '../src/modules/conversions/domain/export.types';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ScreenSourceType, ScreenStatus } from '../src/modules/screens/domain/screen.types';

const ORG = '6650cc00cc00cc00cc00cc01';
const PROJECT = '6650aa00aa00aa00aa00aa01';

const TASKLET = `package cobolprogramclasses.cbact02c.tasklet;

import jp.co.fpt.common.Console;
import org.springframework.batch.core.step.tasklet.Tasklet;
import cobolprogramclasses.cbact02c.model.Cbact02cModel;

public class Cbact02cTasklet implements Tasklet {
}
`;
const MODEL = `package cobolprogramclasses.cbact02c.model;

public class Cbact02cModel {
}
`;

function screen(id: string, name: string, sourceType = ScreenSourceType.BMS) {
  return {
    id,
    organizationId: ORG,
    projectId: PROJECT,
    name,
    sourceType,
    status: ScreenStatus.COMPLETED,
    inputReference: 'sources/x',
    createdBy: 'staff-1',
    createdAt: new Date('2026-10-01'),
    updatedAt: new Date('2026-10-01'),
  };
}

function job(screenId: string, status: ConversionJobStatus, extra: Record<string, unknown> = {}) {
  return {
    id: `job-${screenId}-${status}`,
    organizationId: ORG,
    projectId: PROJECT,
    screenId,
    status,
    createdAt: new Date('2026-10-02'),
    completedAt: status === ConversionJobStatus.COMPLETED ? new Date('2026-10-02') : undefined,
    resultReference: status === ConversionJobStatus.COMPLETED ? `results/${screenId}` : undefined,
    ...extra,
  };
}

function paths(items: ExportFileItem[]): string[] {
  return items.flatMap((i) => (i.type === 'dir' ? paths(i.children ?? []) : [i.path]));
}

function find(items: ExportFileItem[], path: string): ExportFileItem | undefined {
  for (const item of items) {
    if (item.type === 'file' && item.path === path) return item;
    const nested = find(item.children ?? [], path);
    if (nested) return nested;
  }
  return undefined;
}

describe('PartnerBundleService (UC-48)', () => {
  const jobs = { listByProject: jest.fn() };
  const screens = { listByProject: jest.fn() };
  const storage = { readFiles: jest.fn(), writeFiles: jest.fn(), resolvePath: jest.fn() };
  const bundles = { listByProject: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  let service: PartnerBundleService;

  const options = {
    selectedScreenIds: [] as string[],
    includeTypeScript: true,
    includeUnitTests: true,
    includeDocumentation: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: ORG });
    bundles.listByProject.mockResolvedValue([]);
    service = new PartnerBundleService(
      jobs as never,
      screens as never,
      storage as never,
      bundles as never,
      organizationContext as never,
      projects as never,
      new ExportCodeService(jobs as never, storage as never, organizationContext as never, projects as never),
    );
  });

  describe('BMS/DSPF project', () => {
    beforeEach(() => {
      projects.getForOrganization.mockResolvedValue({
        id: PROJECT,
        name: 'Core Banking Screens',
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      });
      screens.listByProject.mockResolvedValue([
        screen('s-login', 'LOGIN.bms'),
        screen('s-menu', 'MENU.bms'),
        screen('s-acct', 'ACCT.bms'),
        screen('s-new', 'NEW.bms'),
      ]);
      jobs.listByProject.mockResolvedValue([
        job('s-login', ConversionJobStatus.COMPLETED),
        job('s-menu', ConversionJobStatus.FAILED, { errorCode: 'CONVERSION_ENGINE_UNAVAILABLE', errorMessage: 'D:\\secret\\path' }),
        job('s-acct', ConversionJobStatus.PROCESSING),
      ]);
      storage.readFiles.mockResolvedValue([
        { relativePath: 'Login.tsx', content: Buffer.from('export const Login = () => <div />;\n') },
        { relativePath: 'routes.tsx', content: Buffer.from('ignored') },
        { relativePath: 'Login.json', content: Buffer.from('{}') },
      ]);
    });

    it('packages the real .tsx output in a React 19 + Vite project and lists every excluded item with its reason', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, options);

      expect(bundle.summary).toEqual({
        projectName: 'Core Banking Screens',
        targetFramework: 'React 19',
        screensIncluded: 1,
        programsIncluded: 0,
        excludedItems: [
          { name: 'MENU.bms', reason: 'Conversion failed (CONVERSION_ENGINE_UNAVAILABLE)' },
          { name: 'ACCT.bms', reason: 'Conversion is still in progress' },
          { name: 'NEW.bms', reason: 'Not converted yet' },
        ],
      });
      const files = paths(bundle.fileTree);
      expect(files).toEqual(
        expect.arrayContaining([
          'components/Login.tsx',
          'components/Login.test.tsx',
          'package.json',
          'tsconfig.json',
          'vite.config.ts',
          'tailwind.config.js',
          'README.md',
          'RELEASE_NOTES.md',
        ]),
      );
      expect(files.some((p) => p.includes('routes.tsx') || p.endsWith('.json') && p.includes('Login'))).toBe(false);
      expect(JSON.parse(find(bundle.fileTree, 'package.json')?.content ?? '{}').dependencies.react).toBe('^19.2.8');
      expect(JSON.parse(find(bundle.fileTree, 'tsconfig.json')?.content ?? '{}').compilerOptions.strict).toBe(true);
      // The raw error message (which can hold server paths) never leaks into the bundle.
      expect(JSON.stringify(bundle)).not.toContain('secret');
    });

    it('names the package {project}-modernized-bundle-v{n}.zip after the bundles already released', async () => {
      expect((await service.build('staff-1', undefined, PROJECT, options)).packageName).toBe(
        'core-banking-screens-modernized-bundle-v1.zip',
      );
      bundles.listByProject.mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]);
      expect((await service.build('staff-1', undefined, PROJECT, options)).packageName).toBe(
        'core-banking-screens-modernized-bundle-v3.zip',
      );
    });

    it('honours the options: no tests, no docs, non-strict TypeScript', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, {
        ...options,
        includeTypeScript: false,
        includeUnitTests: false,
        includeDocumentation: false,
      });
      const files = paths(bundle.fileTree);
      expect(files.some((p) => p.endsWith('.test.tsx'))).toBe(false);
      expect(files).not.toContain('README.md');
      expect(files).not.toContain('RELEASE_NOTES.md');
      expect(JSON.parse(find(bundle.fileTree, 'tsconfig.json')?.content ?? '{}').compilerOptions.strict).toBe(false);
    });

    it('packages only the selected items and reports ids that are not in the project', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, {
        ...options,
        selectedScreenIds: ['s-login', 'other-project-screen'],
      });
      expect(bundle.summary.screensIncluded).toBe(1);
      expect(bundle.summary.excludedItems).toEqual([
        { name: 'other-project-screen', reason: 'Not part of this project' },
      ]);
    });

    it('puts the staff notes and exclusions in RELEASE_NOTES.md', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, {
        ...options,
        customNotes: 'Use the staging API first.',
      });
      const notes = find(bundle.fileTree, 'RELEASE_NOTES.md')?.content ?? '';
      expect(notes).toContain('- LOGIN.bms');
      expect(notes).toContain('- MENU.bms: Conversion failed (CONVERSION_ENGINE_UNAVAILABLE)');
      expect(notes).toContain('Use the staging API first.');
    });

    it('excludes an item whose stored output cannot be read, with a safe reason', async () => {
      storage.readFiles.mockRejectedValue(new Error("ENOENT: no such file 'D:\\ALSM\\storage\\results'"));
      const bundle = await service.build('staff-1', undefined, PROJECT, options);
      expect(bundle.summary.screensIncluded).toBe(0);
      expect(bundle.summary.excludedItems[0]).toEqual({
        name: 'LOGIN.bms',
        reason: 'Generated output could not be read',
      });
      expect(JSON.stringify(bundle.summary)).not.toContain('ALSM\\storage');
      expect(() => service.assertHasContent(bundle)).toThrow(UnprocessableEntityException);
    });

    it('zips the tree with the generated files at the archive root', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, options);
      const archive = await JSZip.loadAsync(await service.zip(bundle));
      expect(await archive.file('src/components/Login.tsx')?.async('string')).toContain('export const Login');
      expect(archive.file('package.json')).not.toBeNull();
    });

    it('returns a preview outline without file contents', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, options);
      expect(JSON.stringify(service.outline(bundle.fileTree))).not.toContain('export const Login');
    });
  });

  describe('COBOL project', () => {
    beforeEach(() => {
      projects.getForOrganization.mockResolvedValue({
        id: PROJECT,
        name: 'Card Demo Batch',
        conversionType: ConversionType.COBOL_TO_JAVA,
      });
      screens.listByProject.mockResolvedValue([
        screen('p-1', 'CBACT02C.cbl', ScreenSourceType.COBOL),
        screen('p-2', 'CBACT03C.cbl', ScreenSourceType.COBOL),
      ]);
      jobs.listByProject.mockResolvedValue([
        job('p-1', ConversionJobStatus.COMPLETED, { toolVersion: 'tool2java' }),
        job('p-2', ConversionJobStatus.COMPLETED, { toolVersion: 'tool2java' }),
      ]);
      storage.readFiles.mockImplementation(async (ref: string) =>
        ref === 'results/p-1'
          ? [
              { relativePath: 'cobolprogramclasses/cbact02c/Cbact02cTasklet.java', content: Buffer.from(TASKLET) },
              { relativePath: 'out/Cbact02cModel.java', content: Buffer.from(MODEL) },
              { relativePath: 'build.log', content: Buffer.from('log') },
            ]
          : [{ relativePath: 'build.log', content: Buffer.from('nothing') }],
      );
    });

    it('wraps the real .java output in a Spring Boot 3.3 / Java 21 Maven project', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, options);

      expect(bundle.summary.targetFramework).toBe('Spring Boot 3.3');
      expect(bundle.summary.programsIncluded).toBe(1);
      expect(bundle.summary.excludedItems).toEqual([
        { name: 'CBACT03C.cbl', reason: 'Conversion completed but produced no .java files' },
      ]);

      const files = paths(bundle.fileTree);
      expect(files).toEqual(
        expect.arrayContaining([
          'pom.xml',
          'src/main/resources/application.yml',
          'src/main/java/com/alsm/modernized/ModernizedApplication.java',
          // Placed by declared package, not by the tool's output folder.
          'src/main/java/cobolprogramclasses/cbact02c/tasklet/Cbact02cTasklet.java',
          'src/main/java/cobolprogramclasses/cbact02c/model/Cbact02cModel.java',
          'src/test/java/cobolprogramclasses/cbact02c/tasklet/Cbact02cTaskletTest.java',
          'README.md',
        ]),
      );
      expect(files.some((p) => p.endsWith('build.log'))).toBe(false);

      const pom = find(bundle.fileTree, 'pom.xml')?.content ?? '';
      expect(pom).toContain('<version>3.3.5</version>');
      expect(pom).toContain('<java.version>21</java.version>');
      expect(pom).toContain('spring-boot-starter-test');
      // The conversion runtime is not shipped; the pom and README say so instead of pretending.
      expect(pom).toContain('jp.co.fpt');
      expect(find(bundle.fileTree, 'README.md')?.content).toContain('`jp.co.fpt`');
      expect(find(bundle.fileTree, 'src/main/java/com/alsm/modernized/ModernizedApplication.java')?.content).toContain(
        '"cobolprogramclasses"',
      );
    });

    it('leaves out the test scaffold when unit tests are not requested', async () => {
      const bundle = await service.build('staff-1', undefined, PROJECT, { ...options, includeUnitTests: false });
      const files = paths(bundle.fileTree);
      expect(files.some((p) => p.startsWith('src/test/'))).toBe(false);
      expect(find(bundle.fileTree, 'pom.xml')?.content).not.toContain('spring-boot-starter-test');
    });
  });

  it('reports only imports that neither the JDK/Spring nor the bundle provide', () => {
    expect(
      findExternalImports([
        { relativePath: 'a/Tasklet.java', content: TASKLET },
        { relativePath: 'b/Model.java', content: MODEL },
      ]),
    ).toEqual(['jp.co.fpt']);
  });
});
