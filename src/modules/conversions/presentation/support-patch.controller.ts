import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { ConversionSupportPatchService } from '../application/conversion-support-patch.service';
import { ApplySupportPatchDto } from './support-patch.dto';

@ApiTags('Conversion Support Patch')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization ID context',
})
@ApiParam({ name: 'id', description: 'Conversion job ID' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('conversions/:id/support-patch')
export class SupportPatchController {
  constructor(private readonly supportPatch: ConversionSupportPatchService) {}

  @Get()
  @RequirePermissions('conversions.troubleshoot.view')
  @ApiOperation({ summary: 'Current mapping rules and patch history of a conversion job' })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.supportPatch.get(user.userId, organizationId, id);
  }

  @Post()
  @RequirePermissions('conversions.support_patch.apply')
  @ApiOperation({
    summary: 'Save corrected mapping rules and re-queue the failed job at HIGH priority',
    description:
      'Stores the rules and note, resets the attempt count, moves FAILED/DEAD to QUEUED, enqueues it and writes CONVERSION_SUPPORT_PATCH_APPLIED to the audit log.',
  })
  @ApiResponse({ status: 201, description: 'Patch saved and job re-queued' })
  @ApiResponse({ status: 400, description: 'SUPPORT_PATCH_INVALID / CONVERSION_QUEUE_UNAVAILABLE' })
  @ApiResponse({ status: 404, description: 'JOB_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'JOB_NOT_PATCHABLE (job is not FAILED/DEAD)' })
  async apply(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ApplySupportPatchDto,
  ) {
    return this.supportPatch.apply(user.userId, organizationId, id, dto);
  }
}
