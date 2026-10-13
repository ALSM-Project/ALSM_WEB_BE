import 'multer';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { UploadedSourceFile } from '../../conversions/application/upload-conversion-source.service';
import { CreatePartnerService } from '../application/create-partner.service';
import { ListPartnersService } from '../application/list-partners.service';
import { GetPartnerService } from '../application/get-partner.service';
import { CreatePartnerProjectService } from '../application/create-partner-project.service';
import { ListPartnerProjectsService } from '../application/list-partner-projects.service';
import { UploadPartnerProjectSourceService } from '../application/upload-partner-project-source.service';
import { CreatePartnerDto, CreatePartnerProjectDto } from './partner.dto';

const maxUploadSizeBytes = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB || 50) * 1024 * 1024;
const maxUploadFilesPerRequest = Number(process.env.MAX_UPLOAD_FILES_PER_REQUEST || 300);

@ApiTags('Partners (UC-44 / UC-45 / UC-46)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('partners')
export class PartnerController {
  constructor(
    private readonly createPartnerService: CreatePartnerService,
    private readonly listPartnersService: ListPartnersService,
    private readonly getPartnerService: GetPartnerService,
    private readonly createPartnerProjectService: CreatePartnerProjectService,
    private readonly listPartnerProjectsService: ListPartnerProjectsService,
    private readonly uploadPartnerProjectSourceService: UploadPartnerProjectSourceService,
  ) {}

  @Get()
  @RequirePermissions('partners.view')
  @ApiOperation({
    summary: 'List partner profiles',
    description: 'Requires partners.view permission.',
  })
  @ApiResponse({ status: 200, description: 'Partner profiles retrieved successfully' })
  async list() {
    return this.listPartnersService.execute();
  }

  @Post()
  @RequirePermissions('partners.manage')
  @ApiOperation({
    summary: 'Create a partner profile',
    description: 'Requires partners.manage permission.',
  })
  @ApiResponse({ status: 201, description: 'Partner profile created successfully' })
  @ApiResponse({ status: 409, description: 'A partner with this contact email already exists' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerDto) {
    return this.createPartnerService.execute(user.userId, dto);
  }

  @Get(':id')
  @RequirePermissions('partners.view')
  @ApiOperation({
    summary: 'Get a partner profile by id',
    description: 'Requires partners.view permission.',
  })
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiResponse({ status: 200, description: 'Partner profile retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Partner not found' })
  async getById(@Param('id') id: string) {
    return this.getPartnerService.execute(id);
  }

  @Get(':id/projects')
  @RequirePermissions('partners.view')
  @ApiOperation({
    summary: "List a partner's projects (UC-45)",
    description: 'Requires partners.view permission.',
  })
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiResponse({ status: 200, description: 'Projects retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Partner not found' })
  async listProjects(@Param('id') id: string) {
    return this.listPartnerProjectsService.execute(id);
  }

  @Post(':id/projects')
  @RequirePermissions('partners.manage')
  @ApiOperation({
    summary: 'Create a project for a partner (UC-45)',
    description:
      "Requires partners.manage permission. Lazily provisions the partner's Organization workspace on the first project.",
  })
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  @ApiResponse({ status: 404, description: 'Partner not found' })
  async createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePartnerProjectDto,
  ) {
    return this.createPartnerProjectService.execute(user.userId, id, dto);
  }

  @Post(':id/projects/:projectId/source')
  @RequirePermissions('partners.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload source files for a partner project on their behalf (UC-46)',
    description:
      "Requires partners.manage permission. Accepts BMS/DSPF screen files or COBOL programs together with their copybooks, same as the customer-facing upload - just authorized for staff acting on behalf of the partner instead of organization membership.",
  })
  @ApiParam({ name: 'id', description: 'Partner id' })
  @ApiParam({ name: 'projectId', description: 'Project id (must belong to this partner)' })
  @ApiResponse({ status: 201, description: 'Source files stored' })
  @ApiResponse({ status: 404, description: 'Partner or project not found' })
  @UseInterceptors(
    FilesInterceptor('files', maxUploadFilesPerRequest, {
      limits: { fileSize: maxUploadSizeBytes },
    }),
  )
  async uploadProjectSource(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @UploadedFiles() files: UploadedSourceFile[],
  ) {
    return this.uploadPartnerProjectSourceService.execute(user.userId, id, projectId, files ?? []);
  }
}
