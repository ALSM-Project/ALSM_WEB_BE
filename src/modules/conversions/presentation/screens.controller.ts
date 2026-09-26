import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { ScreenService, UploadedFileItem } from '../application/screen.service';

@ApiTags('Screens & Sources')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ScreensController {
  constructor(private readonly screenService: ScreenService) {}

  @Get('projects/:projectId/screens')
  @ApiOperation({ summary: 'List all screens for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of screens' })
  async getScreensByProject(@Param('projectId') projectId: string) {
    return this.screenService.getScreensByProject(projectId);
  }

  @Get('screens/:screenId')
  @ApiOperation({ summary: 'Get single screen details' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Screen details' })
  async getScreenById(@Param('screenId') screenId: string) {
    return this.screenService.getScreenById(screenId);
  }

  @Delete('projects/:projectId/screens/:screenId')
  @ApiOperation({ summary: 'Delete a screen and its associated data' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'screenId', description: 'Screen ID' })
  @ApiResponse({ status: 200, description: 'Screen deleted successfully' })
  async deleteScreen(
    @Param('projectId') projectId: string,
    @Param('screenId') screenId: string,
  ) {
    return this.screenService.deleteScreen(projectId, screenId);
  }

  @Post('projects/:projectId/conversion-sources')
  @ApiOperation({ summary: 'Upload legacy conversion source files (BMS/DSPF/COBOL)' })
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @UseInterceptors(FilesInterceptor('files'))
  async uploadConversionSources(
    @Param('projectId') projectId: string,
    @UploadedFiles() files: UploadedFileItem[],
  ) {
    return this.screenService.uploadConversionSources(projectId, files || []);
  }
}
