import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { ExportCodeService } from '../application/export-code.service';
import { ExportConfigurationDto } from './export.dto';

@ApiTags('Export Code (UC-16)')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/export')
export class ExportController {
  constructor(private readonly exportCodeService: ExportCodeService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate Virtual File Tree & Metrics Preview for Export Code' })
  @ApiResponse({ status: 200, description: 'File tree preview and bundle metrics generated successfully' })
  async previewExport(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: ExportConfigurationDto,
  ) {
    return this.exportCodeService.generateExportPreview(user.userId, organizationId, projectId, {
      ...dto,
      projectId,
    });
  }

  @Post('download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate & Stream Compressed ZIP Bundle for Export Code' })
  @ApiResponse({ status: 200, description: 'ZIP package streamed successfully' })
  async downloadBundle(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @Body() dto: ExportConfigurationDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.exportCodeService.generateZipBuffer(
      user.userId,
      organizationId,
      projectId,
      {
        ...dto,
        projectId,
      },
    );

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
    });

    res.send(buffer);
  }
}
