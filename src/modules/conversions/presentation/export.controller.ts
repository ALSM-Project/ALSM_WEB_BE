import { Body, Controller, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { ExportCodeService } from '../application/export-code.service';
import { ExportConfigurationDto } from './export.dto';

@ApiTags('Export Code (UC-16)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/export')
export class ExportController {
  constructor(private readonly exportCodeService: ExportCodeService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate Virtual File Tree & Metrics Preview for Export Code' })
  @ApiResponse({ status: 200, description: 'File tree preview and bundle metrics generated successfully' })
  async previewExport(
    @Param('projectId') projectId: string,
    @Body() dto: ExportConfigurationDto,
  ) {
    return this.exportCodeService.generateExportPreview(projectId, {
      ...dto,
      projectId,
    });
  }

  @Post('download')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate & Stream Compressed ZIP Bundle for Export Code' })
  @ApiResponse({ status: 200, description: 'ZIP package streamed successfully' })
  async downloadBundle(
    @Param('projectId') projectId: string,
    @Body() dto: ExportConfigurationDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.exportCodeService.generateZipBuffer(
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
