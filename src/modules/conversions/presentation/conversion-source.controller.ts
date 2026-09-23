import {
  Controller,
  Headers,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { UploadConversionSourceService } from '../application/upload-conversion-source.service';

const maxUploadSizeBytes = Number(process.env.MAX_UPLOAD_FILE_SIZE_MB || 50) * 1024 * 1024;
// Program bundles (a COBOL source together with every copybook it needs) can legitimately
// span an entire legacy application's folder — dozens of programs and copybooks uploaded
// together so the conversion engine can resolve COPY statements across all of them at once.
const maxUploadFilesPerRequest = Number(process.env.MAX_UPLOAD_FILES_PER_REQUEST || 300);

@ApiTags('Conversion Source Upload')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false, description: 'Optional organization ID context' })
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/conversion-sources')
export class ConversionSourceController {
  constructor(private readonly uploadSource: UploadConversionSourceService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload legacy source files for conversion',
    description:
      'Accepts BMS/DSPF screen files or COBOL programs together with their copybooks. Returns an inputReference to pass when creating a conversion job.',
  })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Source files stored' })
  @UseInterceptors(
    FilesInterceptor('files', maxUploadFilesPerRequest, { limits: { fileSize: maxUploadSizeBytes } }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    return this.uploadSource.execute(user.userId, organizationId, projectId, files ?? []);
  }
}
