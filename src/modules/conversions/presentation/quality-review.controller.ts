import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { GetConversionQualityReviewService } from '../application/get-conversion-quality-review.service';
import { SubmitConversionQualityReviewService } from '../application/submit-conversion-quality-review.service';
import { SubmitQualityReviewDto } from './quality-review.dto';

@ApiTags('Conversion Quality Review')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization ID context',
})
@UseGuards(JwtAuthGuard)
@Controller()
export class QualityReviewController {
  constructor(
    private readonly getQualityReviewService: GetConversionQualityReviewService,
    private readonly submitQualityReviewService: SubmitConversionQualityReviewService,
  ) {}

  @Get('projects/:projectId/conversions/:conversionJobId/quality-review')
  @ApiOperation({
    summary: 'Get initial conversion quality review details',
    description:
      'Retrieves the existing quality review decision and result file summary for a completed conversion job. Returns a synthetic PENDING status if not yet reviewed.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'conversionJobId', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, description: 'Quality review details returned successfully' })
  @ApiResponse({ status: 400, description: 'Conversion not completed' })
  @ApiResponse({ status: 404, description: 'Conversion job not found' })
  async getQualityReview(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('conversionJobId') conversionJobId: string,
  ) {
    return this.getQualityReviewService.execute(
      user.userId,
      organizationId,
      projectId,
      conversionJobId,
    );
  }

  @Patch('projects/:projectId/conversions/:conversionJobId/quality-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit or update initial conversion quality review',
    description:
      'Sets or updates the quality review decision (ACCEPTED, NEEDS_REWORK, FLAGGED) with optional score and note. Requires MEMBER, ADMIN, or OWNER role.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'conversionJobId', description: 'Conversion Job ID' })
  @ApiResponse({ status: 200, description: 'Quality review updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation or status transition error' })
  @ApiResponse({ status: 403, description: 'Forbidden - Insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Conversion job not found' })
  @ApiResponse({ status: 409, description: 'Conflict - concurrent modification detected' })
  async submitQualityReview(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('conversionJobId') conversionJobId: string,
    @Body() dto: SubmitQualityReviewDto,
  ) {
    return this.submitQualityReviewService.execute({
      userId: user.userId,
      organizationHeader: organizationId,
      projectId,
      conversionJobId,
      status: dto.status,
      reviewNote: dto.reviewNote,
      qualityScore: dto.qualityScore,
    });
  }
}
