import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
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
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { PartnerBundleService } from '../application/partner-bundle.service';
import { PublishPartnerExportService } from '../application/publish-partner-export.service';
import { PartnerExportOptionsDto, TriggerExportAndNotifyDto } from './export.dto';

function sendZip(res: Response, buffer: Buffer, filename: string): void {
  // The package name is already a slug; strip anything that could break the header anyway.
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_');
  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Content-Length': buffer.length.toString(),
    'Access-Control-Expose-Headers': 'Content-Disposition',
  });
  res.send(buffer);
}

@ApiTags('Partner Export (UC-48)')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization ID context',
})
@ApiParam({ name: 'projectId', description: 'Partner project ID' })
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('projects/:projectId/partner-export')
export class PartnerExportController {
  constructor(
    private readonly bundles: PartnerBundleService,
    private readonly publisher: PublishPartnerExportService,
  ) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversion_result.export')
  @ApiOperation({ summary: 'Preview the partner bundle: file tree, size and excluded items' })
  @ApiResponse({ status: 200, description: 'Preview generated' })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: PartnerExportOptionsDto,
  ) {
    const bundle = await this.bundles.build(user.userId, organizationId, projectId, dto);
    return {
      packageName: bundle.packageName,
      summary: bundle.summary,
      metrics: bundle.metrics,
      fileTree: this.bundles.outline(bundle.fileTree),
    };
  }

  @Post('download')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversion_result.export')
  @ApiOperation({ summary: 'Download the partner bundle ZIP without publishing it' })
  @ApiResponse({ status: 200, description: 'ZIP streamed' })
  @ApiResponse({ status: 422, description: 'NO_COMPLETED_ITEMS' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: PartnerExportOptionsDto,
    @Res() res: Response,
  ): Promise<void> {
    const bundle = await this.bundles.build(user.userId, organizationId, projectId, dto);
    this.bundles.assertHasContent(bundle);
    sendZip(res, await this.bundles.zip(bundle), bundle.packageName);
  }

  @Post('publish-and-notify')
  @RequirePermissions('conversion_result.export', 'conversion_result.notify_partner')
  @ApiOperation({
    summary: 'Release the bundle to the partner and email them',
    description:
      'Stores the ZIP, marks the project COMPLETED/exported, bumps the partner export count and writes PARTNER_PROJECT_CODE_EXPORTED atomically, then sends the email. A failed email leaves the release in place with notificationStatus FAILED.',
  })
  @ApiResponse({ status: 201, description: 'Bundle published; see notificationStatus' })
  @ApiResponse({ status: 422, description: 'NO_COMPLETED_ITEMS' })
  @ApiResponse({ status: 503, description: 'MONGO_TRANSACTIONS_REQUIRED / ATOMIC_MUTATION_ABORTED' })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: TriggerExportAndNotifyDto,
  ) {
    return this.publisher.publish(user.userId, organizationId, projectId, dto);
  }

  @Get('bundles')
  @RequirePermissions('conversion_result.export')
  @ApiOperation({ summary: 'Bundles released for this project, newest first' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
  ) {
    return this.publisher.list(user.userId, organizationId, projectId);
  }

  @Get('bundles/:bundleId/download')
  @RequirePermissions('conversion_result.export')
  @ApiOperation({ summary: 'Download the exact ZIP that was released' })
  @ApiResponse({ status: 404, description: 'EXPORT_BUNDLE_NOT_FOUND / EXPORT_BUNDLE_FILE_MISSING' })
  async downloadReleased(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('bundleId') bundleId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.publisher.download(
      user.userId,
      organizationId,
      projectId,
      bundleId,
    );
    sendZip(res, buffer, filename);
  }

  @Post('bundles/:bundleId/notify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('conversion_result.notify_partner')
  @ApiOperation({ summary: 'Retry the partner notification of a released bundle' })
  async retryNotification(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Param('bundleId') bundleId: string,
  ) {
    return this.publisher.retryNotification(user.userId, organizationId, projectId, bundleId);
  }
}
