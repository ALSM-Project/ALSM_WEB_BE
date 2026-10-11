import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { Inject } from '@nestjs/common';
import { FindingStatus } from '../domain/validation.types';
import { LegacyValidationService } from '../application/legacy-validation.service';
import { RuleValidatorService } from '../application/rule-validator.service';
import { ConversionJobService } from '../application/conversion-job.service';
import { SaveFieldMappingService } from '../application/save-field-mapping.service';
import { AUDIT_REPOSITORY, AuditRepository } from '../../audit/domain/audit.repository';
import { FieldMappingEntry } from '../domain/field-mapping.types';

@ApiTags('Validation & Human Review')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization ID context',
})
@UseGuards(JwtAuthGuard)
@Controller()
export class ValidationController {
  constructor(
    private readonly legacyValidation: LegacyValidationService,
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
    return this.legacyValidation.get(user.userId, organizationId, projectId, screenId, jobId);
  }

  @Post('validation-findings/:id/accept')
  @ApiOperation({ summary: 'Accept a validation finding (Mark as CONFIRMED)' })
  @ApiParam({ name: 'id', description: 'Finding ID' })
  async acceptFinding(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.legacyValidation.review(user.userId, organizationId, id, FindingStatus.CONFIRMED);
  }

  @Post('validation-findings/:id/reject')
  @ApiOperation({ summary: 'Reject a validation finding (Mark as REJECTED / False Positive)' })
  @ApiParam({ name: 'id', description: 'Finding ID' })
  async rejectFinding(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.legacyValidation.review(user.userId, organizationId, id, FindingStatus.REJECTED);
  }

  @Post('projects/:projectId/screens/:screenId/reconvert')
  @ApiOperation({
    summary: 'Save mapping correction and re-convert screen (creates new conversion version)',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  async saveAndReconvert(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
    @Body() dto: { mappings: FieldMappingEntry[] },
  ) {
    const resolvedOrganizationId = await this.legacyValidation.authorizeReconvert(
      user.userId,
      organizationId,
      projectId,
      screenId,
    );
    // 1. Save updated field mapping
    await this.saveMapping.execute({
      userId: user.userId,
      organizationHeader: resolvedOrganizationId,
      projectId,
      screenId,
      mappings: dto.mappings,
    });

    // 2. Trigger new conversion version execution via existing Conversion Algorithm
    const newJob = await this.conversions.create(user.userId, resolvedOrganizationId, projectId, {
      screenId,
    });

    // 3. Automatically run validation on the new conversion version
    const validationResult = await this.ruleValidator.runValidation(newJob, resolvedOrganizationId);

    await this.auditRepo.append({
      actorUserId: user.userId,
      organizationId: resolvedOrganizationId,
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
