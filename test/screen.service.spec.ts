import { NotFoundException } from '@nestjs/common';
import { ScreenService } from '../src/modules/screens/application/screen.service';
import { ScreenRepository, ScreenSourceType, ScreenStatus } from '../src/modules/screens/domain/screen.types';
import { OrganizationContextService } from '../src/modules/organizations/application/organization-context.service';
import { ProjectService } from '../src/modules/projects/application/project.service';

describe('ScreenService', () => {
  const screens = { create: jest.fn(), findById: jest.fn(), listByProject: jest.fn(), updateStatus: jest.fn() };
  const context = { resolve: jest.fn() };
  const projects = { getForOrganization: jest.fn() };
  const service = new ScreenService(
    screens as unknown as ScreenRepository,
    context as unknown as OrganizationContextService,
    projects as unknown as ProjectService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    context.resolve.mockResolvedValue({ id: 'org-1' });
  });

  it('creates a screen with READY status directly from the already-resolved org/project', async () => {
    screens.create.mockResolvedValue({ id: 'scr-1' });

    await service.create('org-1', 'p1', 'u1', {
      name: 'LOGIN.bms',
      sourceType: ScreenSourceType.BMS,
      inputReference: 'sources/p1/abc',
    });

    expect(screens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'p1',
        createdBy: 'u1',
        status: ScreenStatus.READY,
      }),
    );
  });

  it('scopes list() to the resolved organization and verified project', async () => {
    projects.getForOrganization.mockResolvedValue({ id: 'p1' });
    screens.listByProject.mockResolvedValue([{ id: 'scr-1' }]);

    const result = await service.list('u1', 'org-1', 'p1');

    expect(result).toEqual([{ id: 'scr-1' }]);
    expect(projects.getForOrganization).toHaveBeenCalledWith('p1', 'org-1');
    expect(screens.listByProject).toHaveBeenCalledWith('p1', 'org-1');
  });

  it('throws NotFoundException when the screen does not exist in the resolved organization', async () => {
    screens.findById.mockResolvedValue(null);
    await expect(service.getById('u1', 'org-1', 'scr-missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
