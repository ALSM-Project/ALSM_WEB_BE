import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import {
  SCREEN_REPOSITORY,
  ScreenRecord,
  ScreenRepository,
  ScreenSourceType,
  ScreenStatus,
} from '../domain/screen.types';
import type { ProgramAnalysis } from '../../conversions/domain/copybook-dependency.types';

@Injectable()
export class ScreenService {
  constructor(
    @Inject(SCREEN_REPOSITORY) private readonly screens: ScreenRepository,
    private readonly organizationContext: OrganizationContextService,
    private readonly projects: ProjectService,
  ) {}

  /** Internal creation, called by UploadConversionSourceService once org/project auth has already been resolved for the upload itself — not exposed directly over HTTP. */
  async create(
    organizationId: string,
    projectId: string,
    userId: string,
    input: { name: string; sourceType: ScreenSourceType; inputReference: string; sizeBytes?: number },
  ): Promise<ScreenRecord> {
    return this.screens.create({
      organizationId,
      projectId,
      name: input.name,
      sourceType: input.sourceType,
      status: ScreenStatus.READY,
      inputReference: input.inputReference,
      sizeBytes: input.sizeBytes,
      createdBy: userId,
    });
  }

  async list(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
  ): Promise<ScreenRecord[]> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    await this.projects.getForOrganization(projectId, organization.id);
    return this.screens.listByProject(projectId, organization.id);
  }

  async getById(
    userId: string,
    organizationHeader: string | undefined,
    screenId: string,
  ): Promise<ScreenRecord> {
    const organization = await this.organizationContext.resolve(userId, organizationHeader);
    const screen = await this.screens.findById(screenId, organization.id);
    if (!screen) {
      throw new NotFoundException({ code: 'SCREEN_NOT_FOUND', message: 'Screen was not found' });
    }
    return screen;
  }

  /** Static COPY-statement dependency analysis result for one COBOL screen, computed once at
   * upload time (see UploadConversionSourceService). 'NOT_ANALYZED' covers non-COBOL screens
   * and any COBOL screen uploaded before this analysis existed. */
  async getCopybookDependencies(
    userId: string,
    organizationHeader: string | undefined,
    screenId: string,
  ): Promise<ProgramAnalysis> {
    const screen = await this.getById(userId, organizationHeader, screenId);
    return {
      program: screen.name,
      status: screen.dependencyStatus ?? 'NOT_ANALYZED',
      dependencies: screen.dependencies ?? [],
    };
  }
}
