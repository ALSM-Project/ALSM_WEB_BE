import { BadRequestException } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JSZip = require('jszip');
import { UploadConversionSourceService } from '../src/modules/conversions/application/upload-conversion-source.service';
import { StoragePort } from '../src/shared/storage/storage.port';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { ConversionType } from '../src/modules/projects/domain/project.types';
import { ScreenService } from '../src/modules/screens/application/screen.service';
import { ScreenSourceType } from '../src/modules/screens/domain/screen.types';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { EffectivePermissionsService } from '../src/modules/rbac/application/effective-permissions.service';

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
  const audit = { append: jest.fn() };
  const effectivePermissions = { getEffectivePermissions: jest.fn() };
  const service = new UploadConversionSourceService(
    storage as unknown as StoragePort,
    organizationContext as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    projects as unknown as ProjectService,
    screenService as unknown as ScreenService,
    audit as unknown as AuditRepository,
    effectivePermissions as unknown as EffectivePermissionsService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    organizationContext.resolve.mockResolvedValue({ id: 'org-1' });
    audit.append.mockResolvedValue(undefined);
    effectivePermissions.getEffectivePermissions.mockResolvedValue([]);
    storage.writeFiles.mockResolvedValue('sources/p1/uuid-1');
    screenService.create.mockImplementation((organizationId, projectId, userId, input) =>
      Promise.resolve({
        id: `scr-${input.name}`,
        organizationId,
        projectId,
        createdBy: userId,
        ...input,
      }),
    );
  });

  it('rejects a request with no files', async () => {
    await expect(service.execute('u1', 'org-1', 'p1', [])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('stores BMS/DSPF files for a BMS_DSPF_TO_FRONTEND project', async () => {
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    });

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
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    });

    await expect(
      service.execute('u1', 'org-1', 'p1', [
        { originalname: 'PROGRAM.cob', buffer: Buffer.from('x'), size: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.writeFiles).not.toHaveBeenCalled();
  });

  it('stores COBOL programs together with their copybooks for a COBOL_TO_JAVA project', async () => {
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.COBOL_TO_JAVA,
    });

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
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.COBOL_TO_JAVA,
    });

    const result = await service.execute('u1', 'org-1', 'p1', [
      { originalname: 'PROGRAM.cob', buffer: Buffer.from('       COPY SHARED.\n'), size: 20 },
      { originalname: 'SHARED.cpy', buffer: Buffer.from('       01 X PIC X.\n'), size: 17 },
    ]);

    expect(screenService.recordDependencyDiagnostics).toHaveBeenCalledTimes(1);
    expect(screenService.recordDependencyDiagnostics).toHaveBeenCalledWith(
      'org-1',
      'scr-PROGRAM.cob',
      expect.objectContaining({
        status: 'READY_FOR_CONVERSION',
        dependencies: [
          expect.objectContaining({
            copyName: 'SHARED',
            status: 'RESOLVED',
            resolvedFile: 'SHARED.cpy',
          }),
        ],
      }),
    );
    expect(result.screens[0].dependencyStatus).toBe('READY_FOR_CONVERSION');
  });

  it('does not run copybook dependency analysis for a BMS_DSPF_TO_FRONTEND upload', async () => {
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
    });

    await service.execute('u1', 'org-1', 'p1', [
      { originalname: 'LOGIN.bms', buffer: Buffer.from('bms'), size: 3 },
    ]);

    expect(screenService.recordDependencyDiagnostics).not.toHaveBeenCalled();
  });

  it('rejects an upload containing two different files with the same name (case-insensitive)', async () => {
    projects.getForOrganization.mockResolvedValue({
      id: 'p1',
      conversionType: ConversionType.COBOL_TO_JAVA,
    });

    await expect(
      service.execute('u1', 'org-1', 'p1', [
        { originalname: 'CVACT01Y.cpy', buffer: Buffer.from('a'), size: 1 },
        { originalname: 'cvact01y.CPY', buffer: Buffer.from('b'), size: 1 },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.writeFiles).not.toHaveBeenCalled();
  });

  describe('empty files and ZIP archives', () => {
    async function zipOf(entries: Record<string, string>): Promise<Buffer> {
      const zip = new JSZip();
      for (const [name, content] of Object.entries(entries)) zip.file(name, content);
      return zip.generateAsync({ type: 'nodebuffer' });
    }

    function archive(buffer: Buffer, name = 'bundle.zip') {
      return { originalname: name, buffer, size: buffer.length };
    }

    it('rejects a 0-byte file with EMPTY_FILE and stores nothing', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      });

      const error = await service
        .execute('u1', 'org-1', 'p1', [
          { originalname: 'EMPTY.bms', buffer: Buffer.alloc(0), size: 0 },
        ])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'EMPTY_FILE' });
      expect(storage.writeFiles).not.toHaveBeenCalled();
    });

    it('expands a .zip into its source files, flattened and creating one screen per program', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.COBOL_TO_JAVA,
      });
      const zip = await zipOf({
        'app/PROG1.cbl': '       IDENTIFICATION DIVISION.\n',
        'app/copy/SHARED.cpy': '       01 X PIC X.\n',
        'README.md': 'not source',
        '__MACOSX/app/._PROG1.cbl': 'junk',
        'app/../../evil/PROG2.cob': '       IDENTIFICATION DIVISION.\n',
      });

      const result = await service.execute('u1', 'org-1', 'p1', [archive(zip)]);

      expect(result.files.map((f) => f.name).sort()).toEqual([
        'PROG1.cbl',
        'PROG2.cob',
        'SHARED.cpy',
      ]);
      expect(storage.writeFiles).toHaveBeenCalledWith(
        'sources/p1',
        expect.arrayContaining([{ relativePath: 'PROG1.cbl', content: expect.any(Buffer) }]),
      );
      expect(result.screens.map((s) => s.name).sort()).toEqual(['PROG1.cbl', 'PROG2.cob']);
      expect(result.ignoredEntries).toEqual(
        expect.arrayContaining(['bundle.zip/README.md', 'bundle.zip/__MACOSX/app/._PROG1.cbl']),
      );
    });

    it('validates files from a .zip by the project conversion type', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      });
      const zip = await zipOf({ 'PROG1.cbl': '       IDENTIFICATION DIVISION.\n' });

      const error = await service
        .execute('u1', 'org-1', 'p1', [archive(zip)])
        .catch((e: unknown) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'EMPTY_ARCHIVE' });
      expect(storage.writeFiles).not.toHaveBeenCalled();
    });

    it('rejects an archive that is not a valid ZIP', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.COBOL_TO_JAVA,
      });

      const error = await service
        .execute('u1', 'org-1', 'p1', [archive(Buffer.from('this is not a zip'))])
        .catch((e: unknown) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'INVALID_ARCHIVE',
      });
    });

    it('rejects an empty source file inside a .zip', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.COBOL_TO_JAVA,
      });
      const zip = await zipOf({ 'PROG1.cbl': '' });

      const error = await service
        .execute('u1', 'org-1', 'p1', [archive(zip)])
        .catch((e: unknown) => e);

      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'EMPTY_FILE' });
    });

    it('rejects a zip that holds the same file name twice after flattening', async () => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.COBOL_TO_JAVA,
      });
      const zip = await zipOf({
        'a/X.cpy': '       01 A PIC X.\n',
        'b/X.cpy': '       01 B PIC X.\n',
      });

      await expect(service.execute('u1', 'org-1', 'p1', [archive(zip)])).rejects.toMatchObject({
        response: { code: 'DUPLICATE_FILE_NAME' },
      });
    });
  });

  describe('audit trail', () => {
    const bms = [{ originalname: 'LOGIN.bms', buffer: Buffer.from('bms'), size: 3 }];

    beforeEach(() => {
      projects.getForOrganization.mockResolvedValue({
        id: 'p1',
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      });
    });

    it('records PARTNER_PROJECT_FILES_UPLOADED for Conversion Staff uploading on a partner behalf', async () => {
      effectivePermissions.getEffectivePermissions.mockResolvedValue([
        'partner_project.view',
        'partner_project.manage_files',
      ]);

      await service.execute('staff-1', 'org-1', 'p1', bms);

      expect(audit.append).toHaveBeenCalledTimes(1);
      expect(audit.append).toHaveBeenCalledWith({
        actorUserId: 'staff-1',
        organizationId: 'org-1',
        action: 'PARTNER_PROJECT_FILES_UPLOADED',
        resourceType: 'PROJECT',
        resourceId: 'p1',
        metadata: { fileCount: '1', screenCount: '1' },
      });
    });

    it('records CONVERSION_SOURCES_UPLOADED for a member without partner file permission', async () => {
      await service.execute('member-1', 'org-1', 'p1', bms);

      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ actorUserId: 'member-1', action: 'CONVERSION_SOURCES_UPLOADED' }),
      );
    });

    it('writes no audit entry when the upload is rejected', async () => {
      await expect(
        service.execute('staff-1', 'org-1', 'p1', [
          { originalname: 'EMPTY.bms', buffer: Buffer.alloc(0), size: 0 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.execute('staff-1', 'org-1', 'p1', [])).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(audit.append).not.toHaveBeenCalled();
    });

    it('still completes the upload when the audit store fails', async () => {
      audit.append.mockRejectedValue(new Error('audit store down'));

      const result = await service.execute('staff-1', 'org-1', 'p1', bms);

      expect(result.screens).toHaveLength(1);
    });
  });
});
