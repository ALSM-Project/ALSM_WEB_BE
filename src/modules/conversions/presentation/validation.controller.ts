import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { Inject } from '@nestjs/common';
import { VALIDATION_REPOSITORY, ValidationRepository, FindingStatus } from '../domain/validation.types';
import { RuleValidatorService } from '../application/rule-validator.service';
import { ConversionJobService } from '../application/conversion-job.service';
import { SaveFieldMappingService } from '../application/save-field-mapping.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { FieldMappingEntry } from '../domain/field-mapping.types';

@ApiTags('Validation & Human Review')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller()
export class ValidationController {
  constructor(
    @Inject(VALIDATION_REPOSITORY) private readonly validationRepo: ValidationRepository,
    private readonly ruleValidator: RuleValidatorService,
    private readonly conversions: ConversionJobService,
    private readonly saveMapping: SaveFieldMappingService,
    @Inject(AUDIT_REPOSITORY) private readonly auditRepo: AuditRepository,
  ) {}

  @Get('projects/:projectId/screens/:screenId/conversions/:jobId/validation')
  @ApiOperation({ summary: 'Get validation run and findings for a conversion version' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiParam({ name: 'jobId', description: 'Conversion Job ID' })
  async getValidation(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
    @Param('jobId') jobId: string,
  ) {
    let run = await this.validationRepo.findRunByJob(jobId);
    let findings = run ? await this.validationRepo.listFindingsByRun(run.id) : [];

    if (!run) {
      const job = await this.conversions.get(user.userId, organizationId, jobId);
      const res = await this.ruleValidator.runValidation(job, organizationId || 'org-default');
      run = res.run;
      findings = res.findings;
    }

    return { run, findings };
  }

  @Post('validation-findings/:id/accept')
  @ApiOperation({ summary: 'Accept a validation finding (Mark as CONFIRMED)' })
  @ApiParam({ name: 'id', description: 'Finding ID' })
  async acceptFinding(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    const updated = await this.validationRepo.updateFindingStatus(
      id,
      FindingStatus.CONFIRMED,
      user.userId,
      'ACCEPTED_BY_HUMAN_REVIEWER',
    );
    await this.auditRepo.append({
      actorUserId: user.userId,
      organizationId: organizationId || 'org-default',
      action: 'FINDING_ACCEPTED',
      resourceType: 'VALIDATION_FINDING',
      resourceId: id,
    });
    return updated;
  }

  @Post('validation-findings/:id/reject')
  @ApiOperation({ summary: 'Reject a validation finding (Mark as REJECTED / False Positive)' })
  @ApiParam({ name: 'id', description: 'Finding ID' })
  async rejectFinding(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    const updated = await this.validationRepo.updateFindingStatus(
      id,
      FindingStatus.REJECTED,
      user.userId,
      'REJECTED_BY_HUMAN_REVIEWER',
    );
    await this.auditRepo.append({
      actorUserId: user.userId,
      organizationId: organizationId || 'org-default',
      action: 'FINDING_REJECTED',
      resourceType: 'VALIDATION_FINDING',
      resourceId: id,
    });
    return updated;
  }

  @Post('projects/:projectId/screens/:screenId/reconvert')
  @ApiOperation({ summary: 'Save mapping correction and re-convert screen (creates new conversion version)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  async saveAndReconvert(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
    @Body() dto: { mappings: FieldMappingEntry[] },
  ) {
    // 1. Save updated field mapping
    await this.saveMapping.execute({
      userId: user.userId,
      organizationHeader: organizationId,
      projectId,
      screenId,
      mappings: dto.mappings,
    });

    // 2. Trigger new conversion version execution via existing Conversion Algorithm
    const newJob = await this.conversions.create(user.userId, organizationId, projectId, {
      screenId,
    });

    // 3. Automatically run validation on the new conversion version
    const validationResult = await this.ruleValidator.runValidation(
      newJob,
      organizationId || 'org-default',
    );

    await this.auditRepo.append({
      actorUserId: user.userId,
      organizationId: organizationId || 'org-default',
      action: 'MAPPING_SAVED_AND_RECONVERTED',
      resourceType: 'CONVERSION_JOB',
      resourceId: newJob.id,
    });

    return {
      job: newJob,
      validation: validationResult,
    };
  }
}
