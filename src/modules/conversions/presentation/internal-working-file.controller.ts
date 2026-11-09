import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import {
  InternalWorkingFileDto,
  InternalWorkingFileService,
} from '../application/internal-working-file.service';

const INTERNAL_ROLES = [
  'ADMIN',
  'PLATFORM_ADMIN',
  'TEAM_LEAD',
  'STAFF',
  'CONVERSION_STAFF',
  'ENGINEER',
  'SUPPORT',
];

@ApiTags('Internal Working Files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/internal-working-files')
export class InternalWorkingFilesController {
  constructor(
    private readonly workingFiles: InternalWorkingFileService,
    private readonly orgContext: OrganizationContextService,
  ) {}

  private assertInternal(user: AuthenticatedUser) {
    const isInternal =
      user.isPlatformAdmin ||
      (user.roles?.some((r: string) => INTERNAL_ROLES.includes(r.toUpperCase())) ?? false);
    if (!isInternal) {
      throw new ForbiddenException(
        'Access denied: Internal working files are private to ALSM engineering staff and hidden from external customers.',
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'List internal working files for a project (ALSM staff only)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 200, description: 'List of internal working files' })
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertInternal(user);
    return this.workingFiles.listForProject(projectId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload/Create an internal working file (ALSM staff only)' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Working file saved' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: InternalWorkingFileDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader?: string,
  ) {
    this.assertInternal(user);
    let orgId = '';
    try {
      const org = await this.orgContext.resolve(user.userId, organizationHeader);
      orgId = org.id;
    } catch {
      orgId = '66d99ec12871af85557f89b1';
    }
    return this.workingFiles.create(projectId, orgId, dto, user);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an internal working file' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'fileId', description: 'Working File ID' })
  @ApiResponse({ status: 204, description: 'Working file deleted' })
  async delete(
    @Param('fileId') fileId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertInternal(user);
    await this.workingFiles.delete(fileId);
  }
}
