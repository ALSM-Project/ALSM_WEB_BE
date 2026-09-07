import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ExportCodeService } from '../src/modules/conversions/application/export-code.service';
import { ExportController } from '../src/modules/conversions/presentation/export.controller';
import { JwtAuthGuard } from '../src/shared/security/jwt-auth.guard';
import type { ExportConfiguration } from '../src/modules/conversions/domain/export.types';

/** Mock guard: bypass authentication trong unit test */
const mockJwtAuthGuard = {
  canActivate: (_ctx: ExecutionContext) => true,
};

describe('ExportCodeService & ExportController', () => {
  let service: ExportCodeService;
  let controller: ExportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [ExportCodeService],
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

  it('should generate file tree preview and bundle metrics', async () => {
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

    const result = await service.generateExportPreview('proj-acme', config);
    expect(result).toHaveProperty('fileTree');
    expect(result).toHaveProperty('metrics');
    expect(result.metrics.selectedScreensCount).toBe(1);
    expect(Array.isArray(result.fileTree)).toBe(true);
  });

  it('should generate zip buffer', async () => {
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

    const { buffer, filename } = await service.generateZipBuffer('proj-acme', config);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(filename).toContain('.zip');
  });

  it('controller preview endpoint should return result from service', async () => {
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

    const response = await controller.previewExport('proj-acme', dto);
    expect(response).toHaveProperty('fileTree');
    expect(response).toHaveProperty('metrics');
  });
});
