import { BadRequestException } from '@nestjs/common';
import { UploadConversionSourceService } from '../src/modules/conversions/application/upload-conversion-source.service';
import { StoragePort } from '../src/shared/storage/storage.port';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ScreenService } from '../src/modules/screens/application/screen.service';
import { ScreenSourceType } from '../src/modules/screens/domain/screen.types';

describe('UploadConversionSourceService', () => {
  const storage = { writeFiles: jest.fn(), resolvePath: jest.fn(), readFiles: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const screenService = {
    create: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    recordDependencyDiagnostics: jest.fn(),
  };
  const service = new UploadConversionSourceService(
    storage as unknown as StoragePort,
    organizationContext as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    projects as unknown as ProjectService,
    screenService as unknown as ScreenService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: 'org-1' });
    storage.writeFiles.mockResolvedValue('sources/p1/uuid-1');
    screenService.create.mockImplementation((organizationId, projectId, userId, input) =>
      Promise.resolve({ id: `scr-${input.name}`, organizationId, projectId, createdBy: userId, ...input }),
    );
  });

  it('rejects a request with no files', async () => {
    await expect(service.execute('u1', 'org-1', 'p1', [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores BMS/DSPF files for a BMS_DSPF_TO_FRONTEND project', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1', conversionType: ConversionType.BMS_DSPF_TO_FRONTEND });

    const result = await service.execute('u1', 'org-1', 'p1', [
      { originalname: 'LOGIN.bms', buffer: Buffer.from('bms'), size: 3 },
    ]);

    expect(result.inputReference).toBe('sources/p1/uuid-1');
    expect(storage.writeFiles).toHaveBeenCalledWith('sources/p1', [
      { relativePath: 'LOGIN.bms', content: Buffer.from('bms') },
    ]);
    expect(screenService.create).toHaveBeenCalledWith('org-1', 'p1', 'u1', {
      name: 'LOGIN.bms',
      sourceType: ScreenSourceType.BMS,
      inputReference: 'sources/p1/uuid-1',
      sizeBytes: 3,
    });
    expect(result.screens).toHaveLength(1);
  });

  it('rejects a .cob file for a BMS_DSPF_TO_FRONTEND project', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1', conversionType: ConversionType.BMS_DSPF_TO_FRONTEND });

    await expect(
      service.execute('u1', 'org-1', 'p1', [{ originalname: 'PROGRAM.cob', buffer: Buffer.from('x'), size: 1 }]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.writeFiles).not.toHaveBeenCalled();
  });

  it('stores COBOL programs together with their copybooks for a COBOL_TO_JAVA project', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1', conversionType: ConversionType.COBOL_TO_JAVA });

    const result = await service.execute('u1', 'org-1', 'p1', [
      { originalname: 'PROGRAM.cob', buffer: Buffer.from('cob'), size: 3 },
      { originalname: 'SHARED.cpy', buffer: Buffer.from('cpy'), size: 3 },
    ]);

    expect(result.files).toEqual([
      { name: 'PROGRAM.cob', sizeBytes: 3 },
      { name: 'SHARED.cpy', sizeBytes: 3 },
    ]);
    // Only the program becomes a screen — the copybook is a supporting file, not a screen of its own.
    expect(screenService.create).toHaveBeenCalledTimes(1);
    expect(screenService.create).toHaveBeenCalledWith(
      'org-1',
      'p1',
      'u1',
      expect.objectContaining({ name: 'PROGRAM.cob', sourceType: ScreenSourceType.COBOL }),
    );
    expect(result.screens).toHaveLength(1);
  });

  it('analyzes copybook dependencies once for a COBOL_TO_JAVA upload and persists per screen', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1', conversionType: ConversionType.COBOL_TO_JAVA });

    const result = await service.execute('u1', 'org-1', 'p1', [
      { originalname: 'PROGRAM.cob', buffer: Buffer.from('       COPY SHARED.\n'), size: 20 },
      { originalname: 'SHARED.cpy', buffer: Buffer.from(''), size: 0 },
    ]);

    expect(screenService.recordDependencyDiagnostics).toHaveBeenCalledTimes(1);
    expect(screenService.recordDependencyDiagnostics).toHaveBeenCalledWith(
      'org-1',
      'scr-PROGRAM.cob',
      expect.objectContaining({
        status: 'READY_FOR_CONVERSION',
        dependencies: [expect.objectContaining({ copyName: 'SHARED', status: 'RESOLVED', resolvedFile: 'SHARED.cpy' })],
      }),
    );
    expect(result.screens[0].dependencyStatus).toBe('READY_FOR_CONVERSION');
  });

  it('does not run copybook dependency analysis for a BMS_DSPF_TO_FRONTEND upload', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1', conversionType: ConversionType.BMS_DSPF_TO_FRONTEND });

    await service.execute('u1', 'org-1', 'p1', [{ originalname: 'LOGIN.bms', buffer: Buffer.from('bms'), size: 3 }]);

    expect(screenService.recordDependencyDiagnostics).not.toHaveBeenCalled();
  });

  it('rejects an upload containing two different files with the same name (case-insensitive)', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1', conversionType: ConversionType.COBOL_TO_JAVA });

    await expect(
      service.execute('u1', 'org-1', 'p1', [
        { originalname: 'CVACT01Y.cpy', buffer: Buffer.from('a'), size: 1 },
        { originalname: 'cvact01y.CPY', buffer: Buffer.from('b'), size: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.writeFiles).not.toHaveBeenCalled();
  });
});
