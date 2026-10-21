import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { STORAGE_PORT, StoragePort } from '../../../shared/storage/storage.port';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { OrganizationAuthorizationService } from '../../organizations/application/organization-authorization.service';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { ProjectService } from '../../projects/application/project.service';
import {
  CONVERSION_JOB_REPOSITORY,
  ConversionJobRepository,
  ConversionJobStatus,
} from '../domain/conversion-job.types';

export interface SaveScreenCodeInput {
  userId: string;
  organizationHeader: string | undefined;
  projectId: string;
  screenId: string;
  code: string;
  filename?: string;
}

@Injectable()
export class SaveScreenCodeService {
  constructor(
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly projects: ProjectService,
    private readonly organizationContext: OrganizationContextService,
    private readonly authorization: OrganizationAuthorizationService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async execute(input: SaveScreenCodeInput): Promise<{ success: boolean; conversionJobId: string }> {
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

    const jobsForScreen = await this.jobs.listByScreen(project.id, input.screenId, organization.id);
    const latestCompleted = jobsForScreen.find(
      (job) => job.status === ConversionJobStatus.COMPLETED && job.resultReference,
    );

    if (!latestCompleted?.resultReference) {
      throw new NotFoundException('No completed conversion found for this screen to update code');
    }

    const files = await this.storage.readFiles(latestCompleted.resultReference);
    const targetFilename = input.filename || `${input.screenId}.tsx`;

    // Specifically identify the screen component file:
    // 1. Exact match with input.filename or basename
    // 2. OR any .tsx / .jsx file that is NOT routes.tsx or router.tsx
    const targetIndex = files.findIndex((f) => {
      const lower = f.relativePath.toLowerCase();
      if (input.filename && (f.relativePath === input.filename || lower.endsWith(`/${input.filename.toLowerCase()}`))) {
        return true;
      }
      if (lower.endsWith('.json')) return false;
      if (lower.endsWith('routes.tsx') || lower.endsWith('router.tsx')) return false;
      return lower.endsWith('.tsx') || lower.endsWith('.jsx');
    });

    const updatedFiles = [...files];
    if (targetIndex >= 0) {
      updatedFiles[targetIndex] = {
        relativePath: files[targetIndex].relativePath,
        content: Buffer.from(input.code, 'utf8'),
      };
    } else {
      updatedFiles.push({
        relativePath: targetFilename,
        content: Buffer.from(input.code, 'utf8'),
      });
    }

    const newResultReference = await this.storage.writeFiles(
      `results/${project.id}/${latestCompleted.id}`,
      updatedFiles,
    );
    await this.jobs.updateResultReference(latestCompleted.id, newResultReference);

    await this.audit.append({
      actorUserId: input.userId,
      organizationId: organization.id,
      action: 'SCREEN_CODE_UPDATED',
      resourceType: 'CONVERSION_JOB',
      resourceId: latestCompleted.id,
    });

    return { success: true, conversionJobId: latestCompleted.id };
  }
}
