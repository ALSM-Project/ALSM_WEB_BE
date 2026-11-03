import {
  Controller,
  Get,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { WorkforceService } from '../application/workforce.service';
import {
  SearchWorkforceQueryDto,
  WorkforceEmployeeDto,
  WorkforceSearchResponseDto,
} from './workforce.dto';

@ApiTags('Workforce Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workforce')
export class WorkforceController {
  constructor(private readonly workforceService: WorkforceService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search workforce directory with strict portal and tenant isolation',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated search results',
    type: WorkforceSearchResponseDto,
  })
  async searchEmployees(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchWorkforceQueryDto,
  ): Promise<WorkforceSearchResponseDto> {
    return this.workforceService.searchEmployees(
      {
        userId: user.userId,
        isPlatformAdmin: user.isPlatformAdmin,
        organizationId: query.organizationId,
      },
      query,
    );
  }

  @Get('internal-staff')
  @ApiOperation({
    summary: 'Retrieve active internal ALSM employees for Web2 operational assignment',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of internal ALSM employees',
    type: [WorkforceEmployeeDto],
  })
  async getInternalStaff(): Promise<WorkforceEmployeeDto[]> {
    return this.workforceService.getInternalEmployees();
  }
}
