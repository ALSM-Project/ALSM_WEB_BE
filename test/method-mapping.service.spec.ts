import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GetMethodMappingService } from '../src/modules/conversions/application/get-method-mapping.service';
import { SaveMethodMappingService } from '../src/modules/conversions/application/save-method-mapping.service';
import { MethodMappingRepository } from '../src/modules/conversions/domain/method-mapping.types';
import { ConversionJobRepository, ConversionJobStatus } from '../src/modules/conversions/domain/conversion-job.types';
import { StoragePort } from '../src/shared/storage/storage.port';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { OrganizationAuthorizationService } from '../src/modules/organizations/application/organization-authorization.service';
import { ProjectService } from '../src/modules/projects/application/project.service';
import { AuditRepository } from '../src/modules/audit/domain/audit.repository';
import { ConversionType, ProjectStatus } from '../src/modules/projects/domain/project.types';

describe('Method mapping (UC-28)', () => {
  const project = {
    id: 'project-a',
    organizationId: 'org-a',
    name: 'A',
    conversionType: ConversionType.COBOL_TO_JAVA,
    status: ProjectStatus.ACTIVE,
    createdBy: 'user-a',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const completedJob = {
    id: 'job-1',
    organizationId: 'org-a',
    projectId: 'project-a',
    screenId: 'scr-cbact01c',
    conversionType: ConversionType.COBOL_TO_JAVA,
    status: ConversionJobStatus.COMPLETED,
    priority: 'NORMAL',
    attemptCount: 0,
    maxAttempts: 3,
    inputReference: 'sources/project-a/x',
    resultReference: 'results/project-a/job-1/v1',
    createdBy: 'user-a',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const generatedJavaContent = `public class Cbact01cTasklet {\n    public Cbact01cTasklet() {}\n    public void execute() {}\n}\n`;

  const methodMappings = { findByScreen: jest.fn(), upsert: jest.fn() };
  const jobs = { listByScreen: jest.fn(), updateResultReference: jest.fn() };
  const storage = { readFiles: jest.fn(), writeFiles: jest.fn(), resolvePath: jest.fn() };
  const organizations = { resolve: jest.fn() };
  const authorization = { require: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const audit = { append: jest.fn() };

  const getService = new GetMethodMappingService(
    methodMappings as unknown as MethodMappingRepository,
    jobs as unknown as ConversionJobRepository,
    storage as unknown as StoragePort,
    projects as unknown as ProjectService,
    organizations as unknown as OrganizationContextService,
  );
  const saveService = new SaveMethodMappingService(
    methodMappings as unknown as MethodMappingRepository,
    jobs as unknown as ConversionJobRepository,
    storage as unknown as StoragePort,
    projects as unknown as ProjectService,
    organizations as unknown as OrganizationContextService,
    authorization as unknown as OrganizationAuthorizationService,
    audit as unknown as AuditRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    organizations.resolve.mockResolvedValue({ id: 'org-a' });
    projects.getForOrganization.mockResolvedValue(project);
  });

  describe('GetMethodMappingService', () => {
    it('returns an honest empty state when the screen has no completed COBOL conversion yet', async () => {
      jobs.listByScreen.mockResolvedValue([]);

      const result = await getService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
      });

      expect(result).toEqual({
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        hasGeneratedCode: false,
        entries: [],
        updatedBy: null,
        updatedAt: null,
      });
      expect(storage.readFiles).not.toHaveBeenCalled();
    });

    it('detects real class/method names from the latest completed job\'s generated code', async () => {
      jobs.listByScreen.mockResolvedValue([completedJob]);
      storage.readFiles.mockResolvedValue([
        { relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java', content: Buffer.from(generatedJavaContent) },
      ]);
      methodMappings.findByScreen.mockResolvedValue(null);

      const result = await getService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
      });

      expect(result.hasGeneratedCode).toBe(true);
      expect(result.entries).toEqual([
        {
          relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java',
          kind: 'CLASS',
          originalName: 'Cbact01cTasklet',
          targetName: 'Cbact01cTasklet',
        },
        {
          relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java',
          kind: 'METHOD',
          originalName: 'execute',
          targetName: 'execute',
        },
      ]);
    });

    it('merges in a previously saved override instead of showing the original name', async () => {
      jobs.listByScreen.mockResolvedValue([completedJob]);
      storage.readFiles.mockResolvedValue([
        { relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java', content: Buffer.from(generatedJavaContent) },
      ]);
      methodMappings.findByScreen.mockResolvedValue({
        id: 'mm-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: [
          {
            relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java',
            kind: 'CLASS',
            originalName: 'Cbact01cTasklet',
            targetName: 'AccountLoaderTasklet',
          },
        ],
        updatedBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await getService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
      });

      const classEntry = result.entries.find((e) => e.kind === 'CLASS');
      expect(classEntry?.targetName).toBe('AccountLoaderTasklet');
    });

    it('does not resolve a project from another organization', async () => {
      projects.getForOrganization.mockRejectedValue(new NotFoundException({ code: 'PROJECT_NOT_FOUND' }));

      await expect(
        getService.execute({ userId: 'user-a', organizationHeader: 'org-a', projectId: 'project-b', screenId: 'scr-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(jobs.listByScreen).not.toHaveBeenCalled();
    });
  });

  describe('SaveMethodMappingService', () => {
    const renamedEntries = [
      {
        relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java',
        kind: 'CLASS' as const,
        originalName: 'Cbact01cTasklet',
        targetName: 'AccountLoaderTasklet',
      },
    ];

    it('rejects a target name that is not a valid Java identifier', async () => {
      await expect(
        saveService.execute({
          userId: 'user-a',
          organizationHeader: 'org-a',
          projectId: 'project-a',
          screenId: 'scr-cbact01c',
          entries: [
            {
              relativePath: 'Foo.java',
              kind: 'CLASS',
              originalName: 'Foo',
              targetName: 'Not A Valid Name',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(methodMappings.upsert).not.toHaveBeenCalled();
    });

    it('requires OWNER/ADMIN/MEMBER role', async () => {
      methodMappings.upsert.mockResolvedValue({
        id: 'mm-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
        updatedBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      jobs.listByScreen.mockResolvedValue([]);

      await saveService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
      });

      expect(authorization.require).toHaveBeenCalledWith(
        { id: 'org-a' },
        'user-a',
        expect.arrayContaining(['OWNER', 'ADMIN', 'MEMBER']),
      );
    });

    it('persists the mapping and appends an audit entry', async () => {
      methodMappings.upsert.mockResolvedValue({
        id: 'mm-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
        updatedBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      jobs.listByScreen.mockResolvedValue([]);

      await saveService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
      });

      expect(methodMappings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-a', projectId: 'project-a', screenId: 'scr-cbact01c' }),
      );
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'METHOD_MAPPING_UPDATED', organizationId: 'org-a' }),
      );
    });

    // Regression coverage for the exact pre-existing BMS field-mapping gap this must not
    // repeat: saving a mapping override must actually change the real generated code, not
    // just sit as inert metadata that nothing ever reads on the primary path.
    it('applies the real rename to the latest generated code and points the job at the new result', async () => {
      methodMappings.upsert.mockResolvedValue({
        id: 'mm-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
        updatedBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      jobs.listByScreen.mockResolvedValue([completedJob]);
      storage.readFiles.mockResolvedValue([
        { relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java', content: Buffer.from(generatedJavaContent) },
      ]);
      storage.writeFiles.mockResolvedValue('results/project-a/job-1/v2');

      await saveService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
      });

      expect(storage.writeFiles).toHaveBeenCalledWith(
        'results/project-a/job-1',
        expect.arrayContaining([
          expect.objectContaining({
            relativePath: 'cobolprogramclasses/cbact01c/Cbact01cTasklet.java',
            content: expect.any(Buffer),
          }),
        ]),
      );
      const writtenContent = (storage.writeFiles.mock.calls[0][1][0].content as Buffer).toString('utf8');
      expect(writtenContent).toContain('AccountLoaderTasklet');
      expect(writtenContent).not.toContain('Cbact01cTasklet');
      expect(jobs.updateResultReference).toHaveBeenCalledWith('job-1', 'results/project-a/job-1/v2');
    });

    it('does not touch generated code when no name actually changed', async () => {
      methodMappings.upsert.mockResolvedValue({
        id: 'mm-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: [],
        updatedBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await saveService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: [
          {
            relativePath: 'Foo.java',
            kind: 'CLASS',
            originalName: 'Foo',
            targetName: 'Foo', // unchanged
          },
        ],
      });

      expect(jobs.listByScreen).not.toHaveBeenCalled();
      expect(storage.writeFiles).not.toHaveBeenCalled();
    });

    it('still saves the mapping even if applying it to the existing output fails', async () => {
      methodMappings.upsert.mockResolvedValue({
        id: 'mm-1',
        organizationId: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
        updatedBy: 'user-a',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      jobs.listByScreen.mockRejectedValue(new Error('storage unavailable'));

      const result = await saveService.execute({
        userId: 'user-a',
        organizationHeader: 'org-a',
        projectId: 'project-a',
        screenId: 'scr-cbact01c',
        entries: renamedEntries,
      });

      expect(result.id).toBe('mm-1');
      expect(methodMappings.upsert).toHaveBeenCalled();
    });
  });
});
