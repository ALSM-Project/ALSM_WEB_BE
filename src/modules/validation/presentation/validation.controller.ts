import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { ValidationReadService } from '../application/validation-read.service';
import { TriggerAiValidationService } from '../application/trigger-ai-validation.service';
import { ValidationFindingResponseDto, ValidationRunResponseDto } from './validation.dto';

@ApiTags('Validation')
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
    private readonly validationReads: ValidationReadService,
    private readonly triggerAiValidation: TriggerAiValidationService,
  ) {}

  @Post('projects/:projectId/conversions/:conversionJobId/validation-runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue an AI validation run for a completed conversion' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'conversionJobId', description: 'Conversion Job ID' })
  @ApiResponse({ status: 202, type: ValidationRunResponseDto })
  @ApiResponse({ status: 400, description: 'Conversion is not eligible for AI validation' })
  @ApiResponse({ status: 403, description: 'Organization role cannot trigger validation' })
  @ApiResponse({ status: 404, description: 'Project or conversion job not found' })
  @ApiResponse({ status: 503, description: 'AI validation or its queue is unavailable' })
  async trigger(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('conversionJobId') conversionJobId: string,
  ) {
    const result = await this.triggerAiValidation.execute(
      user.userId,
      organizationId,
      projectId,
      conversionJobId,
    );
    return result.run;
  }

  @Get('projects/:projectId/conversions/:conversionJobId/validation-runs')
  @ApiOperation({ summary: 'List validation runs for a conversion job' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'conversionJobId', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, type: ValidationRunResponseDto, isArray: true })
  @ApiResponse({ status: 403, description: 'Organization access denied' })
  @ApiResponse({ status: 404, description: 'Project or conversion job not found' })
  async listRuns(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('conversionJobId') conversionJobId: string,
  ) {
    return this.validationReads.listRuns(user.userId, organizationId, projectId, conversionJobId);
  }

  @Get('projects/:projectId/validation-runs/:validationRunId')
  @ApiOperation({ summary: 'Get a validation run' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'validationRunId', description: 'Validation Run ID' })
  @ApiResponse({ status: 200, type: ValidationRunResponseDto })
  @ApiResponse({ status: 403, description: 'Organization access denied' })
  @ApiResponse({ status: 404, description: 'Project or validation run not found' })
  async getRun(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('validationRunId') validationRunId: string,
  ) {
    return this.validationReads.getRun(user.userId, organizationId, projectId, validationRunId);
  }

  @Get('projects/:projectId/validation-runs/:validationRunId/findings')
  @ApiOperation({ summary: 'List findings for a validation run' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'validationRunId', description: 'Validation Run ID' })
  @ApiResponse({ status: 200, type: ValidationFindingResponseDto, isArray: true })
  @ApiResponse({ status: 403, description: 'Organization access denied' })
  @ApiResponse({ status: 404, description: 'Project or validation run not found' })
  async listFindings(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('validationRunId') validationRunId: string,
  ) {
    return this.validationReads.listFindings(
      user.userId,
      organizationId,
      projectId,
      validationRunId,
    );
  }
}
