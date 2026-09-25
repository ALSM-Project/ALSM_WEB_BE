import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
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
  MethodMappingRecord,
  MethodMappingRepository,
} from '../domain/method-mapping.types';
import { applyJavaRenames, isValidJavaIdentifier } from '../infrastructure/java-rename.util';

export interface SaveMethodMappingInput {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  screenId: string;
  entries: MethodMappingEntry[];
}

@Injectable()
export class SaveMethodMappingService {
  private readonly logger = new Logger(SaveMethodMappingService.name);

  constructor(
    @Inject(METHOD_MAPPING_REPOSITORY) private readonly methodMappings: MethodMappingRepository,
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: SaveMethodMappingInput): Promise<MethodMappingRecord> {
    const organization = await this.organizationContext.resolve(
      input.userId,
      input.organizationHeader,
    );
    this.authorization.require(organization, input.userId, [
      OrganizationRole.OWNER,
      OrganizationRole.ADMIN,
      OrganizationRole.MEMBER,
    ]);
    const project = await this.projects.getForOrganization(input.projectId, organization.id);

    const invalid = input.entries.find((entry) => !isValidJavaIdentifier(entry.targetName));
    if (invalid) {
      throw new BadRequestException({
        code: 'INVALID_JAVA_IDENTIFIER',
        message: `"${invalid.targetName}" is not a valid Java identifier`,
      });
    }

    const record = await this.methodMappings.upsert({
      organizationId: organization.id,
      projectId: project.id,
      screenId: input.screenId,
      entries: input.entries,
      updatedBy: input.userId,
    });

    try {
      await this.applyRenamesToGeneratedCode(project.id, input.screenId, organization.id, input.entries);
    } catch (error) {
      // The mapping itself is already saved and valid for the next conversion run - a
      // storage hiccup while amending the *existing* output must not undo that or block
      // the user from continuing.
      this.logger.warn(
        `Saved method mapping for screen ${input.screenId} but failed to apply it to the existing generated code: ${String(error)}`,
      );
    }

    await this.audit.append({
      actorUserId: input.userId,
      organizationId: organization.id,
      action: 'METHOD_MAPPING_UPDATED',
      resourceType: 'METHOD_MAPPING',
      resourceId: `${project.id}:${input.screenId}`,
    });

    return record;
  }

  /** Rewrites the screen's latest generated .java files so a saved rename is actually
   * visible in the generated code, not just persisted as inert metadata (the existing BMS
   * field-mapping only ever affects a rarely-hit fallback path — this must not repeat that
   * for method mapping). Best-effort: a missing/unreadable result must not fail the save of
   * the mapping itself, since the mapping is still valid to apply to the *next* conversion. */
  private async applyRenamesToGeneratedCode(
    projectId: string,
    screenId: string,
    organizationId: string,
    entries: MethodMappingEntry[],
  ): Promise<void> {
    const renamed = entries.filter((entry) => entry.targetName !== entry.originalName);
    if (renamed.length === 0) return;

    const jobsForScreen = await this.jobs.listByScreen(projectId, screenId, organizationId);
    const latestCompleted = jobsForScreen.find(
      (job) => job.status === ConversionJobStatus.COMPLETED && job.resultReference,
    );
    if (!latestCompleted?.resultReference) return;

    const files = await this.storage.readFiles(latestCompleted.resultReference);
    const textFiles = files.map((file) => ({
      relativePath: file.relativePath,
      content: file.content.toString('utf8'),
    }));
    const updated = applyJavaRenames(
      textFiles,
      renamed.map((entry) => ({
        relativePath: entry.relativePath,
        originalName: entry.originalName,
        targetName: entry.targetName,
      })),
    );
    const newResultReference = await this.storage.writeFiles(
      `results/${projectId}/${latestCompleted.id}`,
      updated.map((file) => ({ relativePath: file.relativePath, content: Buffer.from(file.content, 'utf8') })),
    );
    await this.jobs.updateResultReference(latestCompleted.id, newResultReference);
  }
}
