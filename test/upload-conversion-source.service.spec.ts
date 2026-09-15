import { BadRequestException } from '@nestjs/common';
import { UploadConversionSourceService } from '../src/modules/conversions/application/upload-conversion-source.service';
import { StoragePort } from '../src/shared/storage/storage.port';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';

describe('UploadConversionSourceService', () => {
  const storage = { writeFiles: jest.fn(), resolvePath: jest.fn(), readFiles: jest.fn() };
  const organizationContext = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const service = new UploadConversionSourceService(
    storage as unknown as StoragePort,
    organizationContext as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    projects as unknown as ProjectService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: 'org-1' });
    storage.writeFiles.mockResolvedValue('sources/p1/uuid-1');
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
  });
});
