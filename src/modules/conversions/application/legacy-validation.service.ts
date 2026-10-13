import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { Organization } from '../../organizations/infrastructure/organization.schema';
import { OrganizationRole } from '../../organizations/domain/organization.types';
import { Project } from '../../projects/infrastructure/project.schema';
import { ConversionType } from '../../projects/domain/project.types';
import { Screen } from '../../screens/infrastructure/screen.schema';
import { CONVERSION_JOB_REPOSITORY, ConversionJobRepository } from '../domain/conversion-job.types';
import {
  FindingStatus,
  LegacyValidationScope,
  VALIDATION_REPOSITORY,
  ValidationRepository,
} from '../domain/validation.types';
import { RuleValidatorService } from './rule-validator.service';

@Injectable()
export class LegacyValidationService {
  constructor(
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(Project.name) private readonly projects: Model<Project>,
    @InjectModel(Screen.name) private readonly screens: Model<Screen>,
    @Inject(CONVERSION_JOB_REPOSITORY) private readonly jobs: ConversionJobRepository,
    @Inject(VALIDATION_REPOSITORY) private readonly validation: ValidationRepository,
    private readonly rules: RuleValidatorService,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
  ) {}

  async get(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    screenId: string,
    jobId: string,
  ) {
    const organizationId = await this.resolveOrganization(userId, organizationHeader, false);
    const job = await this.requireJob(organizationId, projectId, screenId, jobId);
    const scope = { organizationId, projectId, screenId, conversionJobId: job.id };
    const run = await this.validation.findRunByJob(scope);
    if (run) return { run, findings: await this.validation.listFindingsByRun(run.id, scope) };
    // Lazy creation is a write, even though existing results are readable by viewers.
    await this.resolveOrganization(userId, organizationId, true);
    return this.rules.runValidation(job, organizationId);
  }

  async review(
    userId: string,
    organizationHeader: string | undefined,
    id: string,
    status: FindingStatus.CONFIRMED | FindingStatus.REJECTED,
  ) {
    const organizationId = await this.resolveOrganization(userId, organizationHeader, true);
    this.requireId(id);
    const finding = await this.validation.findFindingById(id, organizationId);
    if (!finding) throw this.notFound();
    await this.requireJob(
      organizationId,
      finding.projectId,
      finding.screenId,
      finding.conversionJobId,
    );
    const scope: LegacyValidationScope & { validationRunId: string } = {
      organizationId,
      projectId: finding.projectId,
      screenId: finding.screenId,
      conversionJobId: finding.conversionJobId,
      validationRunId: finding.validationRunId,
    };
    this.requireId(finding.validationRunId);
    if (!(await this.validation.findRunById(finding.validationRunId, scope))) throw this.notFound();
    const accepted = status === FindingStatus.CONFIRMED;
    const updated = await this.validation.updateFindingStatus(
      id,
      status,
      scope,
      userId,
      accepted ? 'ACCEPTED_BY_HUMAN_REVIEWER' : 'REJECTED_BY_HUMAN_REVIEWER',
    );
    if (!updated) throw this.notFound();
    await this.audit.append({
      actorUserId: userId,
      organizationId,
      action: accepted ? 'FINDING_ACCEPTED' : 'FINDING_REJECTED',
      resourceType: 'VALIDATION_FINDING',
      resourceId: id,
    });
    return updated;
  }

  async authorizeReconvert(
    userId: string,
    organizationHeader: string | undefined,
    projectId: string,
    screenId: string,
  ): Promise<string> {
    const organizationId = await this.resolveOrganization(userId, organizationHeader, true);
    await this.requireScreen(organizationId, projectId, screenId);
    return organizationId;
  }

  private async resolveOrganization(
    userId: string,
    header: string | undefined,
    write: boolean,
  ): Promise<string> {
    this.requireId(userId);
    if (header !== undefined) this.requireId(header);
    // The shared context/project services provision records and fall back to other
    // scopes. Authorization here must be read-only and must honor the exact tenant.
    const organization = await this.organizations
      .findOne({
        ...(header !== undefined ? { _id: new Types.ObjectId(header) } : {}),
        'members.userId': new Types.ObjectId(userId),
      })
      .exec();
    const member = organization?.members.find((entry) => entry.userId.toString() === userId);
    const allowed = write
      ? [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.MEMBER]
      : Object.values(OrganizationRole);
    if (!organization || !member || !allowed.includes(member.role)) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'You do not have access to this organization action',
      });
    }
    return organization.id;
  }

  private async requireJob(
    organizationId: string,
    projectId: string,
    screenId: string,
    jobId: string,
  ) {
    this.requireId(jobId);
    await this.requireScreen(organizationId, projectId, screenId);
    const job = await this.jobs.findById(jobId, organizationId);
    if (
      !job ||
      job.organizationId !== organizationId ||
      job.projectId !== projectId ||
      job.screenId !== screenId ||
      job.conversionType !== ConversionType.BMS_DSPF_TO_FRONTEND
    )
      throw this.notFound();
    return job;
  }

  private async requireScreen(
    organizationId: string,
    projectId: string,
    screenId: string,
  ): Promise<void> {
    this.requireId(projectId);
    if (!screenId || screenId.length > 512) throw this.notFound();
    const project = await this.projects
      .findOne({
        _id: new Types.ObjectId(projectId),
        organizationId: new Types.ObjectId(organizationId),
        deletedAt: { $exists: false },
        conversionType: ConversionType.BMS_DSPF_TO_FRONTEND,
      })
      .exec();
    if (!project) throw this.notFound();
    // Both screen schemas use this collection. Legacy uploads stored projectId as
    // a string and omitted organizationId; their verified parent supplies ownership.
    // Use the raw collection so Mongoose cannot cast away either storage format.
    const screen = await this.screens.collection.findOne({
      projectId: { $in: [new Types.ObjectId(projectId), projectId] },
      $and: [
        {
          $or: [
            { organizationId: new Types.ObjectId(organizationId) },
            { organizationId: { $exists: false } },
          ],
        },
        {
          $or: [
            ...(Types.ObjectId.isValid(screenId)
              ? [{ _id: new Types.ObjectId(screenId) }]
              : [
                  { name: screenId },
                  { inputReference: screenId },
                  { name: { $in: [`${screenId}.bms`, `${screenId}.dspf`] } },
                ]),
          ],
        },
      ],
      sourceType: { $in: ['BMS', 'DSPF'] },
    });
    if (!screen) throw this.notFound();
  }

  private requireId(id: string): void {
    if (!/^[a-f\d]{24}$/i.test(id ?? '')) throw this.notFound();
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'LEGACY_VALIDATION_NOT_FOUND',
      message: 'Legacy validation resource was not found',
    });
  }
}
