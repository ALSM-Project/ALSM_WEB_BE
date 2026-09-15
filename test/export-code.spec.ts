import { Test, TestingModule } from '@nestjs/testing';
import { ExportCodeService } from '../src/modules/conversions/application/export-code.service';
import { ExportController } from '../src/modules/conversions/presentation/export.controller';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import { STORAGE_PORT } from '../src/shared/storage/storage.port';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobStatus,
} from '../src/modules/conversions/domain/conversion-job.types';
import type { ExportConfiguration } from '../src/modules/conversions/domain/export.types';

const mockJwtAuthGuard = { canActivate: () => true };

describe('ExportCodeService & ExportController', () => {
  let service: ExportCodeService;
  let controller: ExportController;
  let jobs: { listByScreen: jest.Mock };
  let storage: { readFiles: jest.Mock; writeFiles: jest.Mock; resolvePath: jest.Mock };
  let organizationContext: { resolve: jest.Mock };
  let projects: { getForOrganization: jest.Mock };

  beforeEach(async () => {
    jobs = { listByScreen: jest.fn() };
    storage = { readFiles: jest.fn(), writeFiles: jest.fn(), resolvePath: jest.fn() };
    organizationContext = { resolve: jest.fn().mockResolvedValue({ id: 'org-1' }) };
    projects = { getForOrganization: jest.fn().mockResolvedValue({ id: 'proj-acme' }) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [
        ExportCodeService,
        { provide: CONVERSION_JOB_REPOSITORY, useValue: jobs },
        { provide: STORAGE_PORT, useValue: storage },
        { provide: OrganizationContextService, useValue: organizationContext },
        { provide: ProjectService, useValue: projects },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    service = module.get<ExportCodeService>(ExportCodeService);
    controller = module.get<ExportController>(ExportController);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(controller).toBeDefined();
  });

  it('should build the export preview from a real completed conversion job', async () => {
    jobs.listByScreen.mockResolvedValue([
      {
        id: 'job-1',
        status: ConversionJobStatus.COMPLETED,
        resultReference: 'results/proj-acme/job-1/abc',
        completedAt: new Date('2024-01-02'),
      },
    ]);
    storage.readFiles.mockResolvedValue([
      { relativePath: 'ScrLogin.tsx', content: Buffer.from('export const ScrLogin = () => null;') },
      { relativePath: 'bmsRoutes.tsx', content: Buffer.from('export const routes = [];') },
    ]);

    const config: ExportConfiguration = {
      projectId: 'proj-acme',
      projectName: 'Acme Corp',
      outputOption: 'scaffold',
      frameworkTarget: 'react-19',
      stylingOption: 'tailwind',
      includeTypeScriptStrict: true,
      includeUnitTests: true,
      includeStorybook: false,
      includeDocumentation: true,
      selectedScreenIds: ['scr-login'],
    };

    const result = await service.generateExportPreview('user-1', undefined, 'proj-acme', config);
    expect(result.metrics.selectedScreensCount).toBe(1);
    expect(Array.isArray(result.fileTree)).toBe(true);
    const asJson = JSON.stringify(result.fileTree);
    expect(asJson).toContain('export const ScrLogin');
    expect(asJson).not.toContain('Generated React component by ALSM Backend Engine');
  });

  it('should skip screens with no completed conversion job instead of faking content', async () => {
    jobs.listByScreen.mockResolvedValue([]);

    const config: ExportConfiguration = {
      projectId: 'proj-acme',
      projectName: 'Acme Corp',
      outputOption: 'standalone',
      frameworkTarget: 'react-19',
      stylingOption: 'tailwind',
      includeTypeScriptStrict: true,
      includeUnitTests: false,
      includeStorybook: false,
      includeDocumentation: true,
      selectedScreenIds: ['scr-not-converted'],
    };

    const result = await service.generateExportPreview('user-1', undefined, 'proj-acme', config);
    expect(result.metrics.selectedScreensCount).toBe(0);
    const asJson = JSON.stringify(result.fileTree);
    expect(asJson).toContain('Not Included');
  });

  it('should generate a zip buffer', async () => {
    jobs.listByScreen.mockResolvedValue([
      {
        id: 'job-1',
        status: ConversionJobStatus.COMPLETED,
        resultReference: 'results/proj-acme/job-1/abc',
        completedAt: new Date('2024-01-02'),
      },
    ]);
    storage.readFiles.mockResolvedValue([
      { relativePath: 'ScrLogin.tsx', content: Buffer.from('export const ScrLogin = () => null;') },
    ]);

    const config: ExportConfiguration = {
      projectId: 'proj-acme',
      projectName: 'Acme Corp',
      outputOption: 'standalone',
      frameworkTarget: 'react-19',
      stylingOption: 'tailwind',
      includeTypeScriptStrict: true,
      includeUnitTests: false,
      includeStorybook: false,
      includeDocumentation: true,
      selectedScreenIds: ['scr-login'],
    };

    const { buffer, filename } = await service.generateZipBuffer('user-1', undefined, 'proj-acme', config);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(filename).toContain('.zip');
  });

  it('controller preview endpoint should scope by the current user/organization', async () => {
    jobs.listByScreen.mockResolvedValue([]);
    const dto = {
      outputOption: 'scaffold' as const,
      frameworkTarget: 'react-19' as const,
      stylingOption: 'tailwind' as const,
      includeTypeScriptStrict: true,
      includeUnitTests: true,
      includeStorybook: false,
      includeDocumentation: true,
      selectedScreenIds: ['scr-login'],
      projectName: 'Acme Corp',
    };

    const response = await controller.previewExport(
      { userId: 'user-1' } as never,
      'org-1',
      'proj-acme',
      dto,
    );
    expect(response).toHaveProperty('fileTree');
    expect(response).toHaveProperty('metrics');
    expect(organizationContext.resolve).toHaveBeenCalledWith('user-1', 'org-1');
    expect(projects.getForOrganization).toHaveBeenCalledWith('proj-acme', 'org-1');
  });
});
