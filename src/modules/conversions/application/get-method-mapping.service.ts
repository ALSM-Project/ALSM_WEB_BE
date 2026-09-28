import { Inject, Injectable } from '@nestjs/common';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { ProjectService } from '../../projects/application/project.service';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';
import {
  METHOD_MAPPING_REPOSITORY,
  MethodMappingEntry,
  MethodMappingRepository,
} from '../domain/method-mapping.types';
import { detectJavaMembers } from '../infrastructure/java-member-detector.util';

export interface GetMethodMappingInput {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  screenId: string;
}

export interface MethodMappingView {
  projectId: string;
  screenId: string;
  /** True once at least one COBOL→Java conversion has completed for this screen - the FE
   * needs this to tell "nothing to map yet" apart from "the mapping is genuinely empty". */
  hasGeneratedCode: boolean;
  entries: MethodMappingEntry[];
  updatedBy: string | null;
  updatedAt: Date | null;
}

@Injectable()
export class GetMethodMappingService {
  constructor(
    @Inject(METHOD_MAPPING_REPOSITORY) private readonly methodMappings: MethodMappingRepository,
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
  ) {}

  async execute(input: GetMethodMappingInput): Promise<MethodMappingView> {
    const organization = await this.organizationContext.resolve(
      input.userId,
      input.organizationHeader,
    );
    const project = await this.projects.getForOrganization(input.projectId, organization.id);

    const jobsForScreen = await this.jobs.listByScreen(project.id, input.screenId, organization.id);
    const latestCompleted = jobsForScreen.find(
      (job) => job.status === ConversionJobStatus.COMPLETED && job.resultReference,
    );

    // No fabricated fallback rows - a screen with no completed COBOL conversion yet has
    // nothing real to map, and says so.
    if (!latestCompleted?.resultReference) {
      return {
        projectId: project.id,
        screenId: input.screenId,
        hasGeneratedCode: false,
        entries: [],
        updatedBy: null,
        updatedAt: null,
      };
    }

    const files = await this.storage.readFiles(latestCompleted.resultReference);
    const detected = detectJavaMembers(
      files.map((file) => ({ relativePath: file.relativePath, content: file.content.toString('utf8') })),
    );

    const record = await this.methodMappings.findByScreen(project.id, input.screenId, organization.id);
    const savedTargetByKey = new Map(
      (record?.entries ?? []).map((entry) => [
        `${entry.relativePath}::${entry.kind}::${entry.originalName}`,
        entry.targetName,
      ]),
    );

    const entries: MethodMappingEntry[] = detected.map((member) => ({
      relativePath: member.relativePath,
      kind: member.kind,
      originalName: member.name,
      targetName:
        savedTargetByKey.get(`${member.relativePath}::${member.kind}::${member.name}`) ?? member.name,
    }));

    return {
      projectId: project.id,
      screenId: input.screenId,
      hasGeneratedCode: true,
      entries,
      updatedBy: record?.updatedBy ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  }
}
