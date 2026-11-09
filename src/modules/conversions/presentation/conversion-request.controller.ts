import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import {
  ConversionRequestService,
  CreateConversionRequestDto,
  ReviewConversionRequestDto,
} from '../application/conversion-request.service';

@ApiTags('Enterprise Conversion Requests (Managed Modernization Services)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('conversion-requests')
export class ConversionRequestController {
  constructor(
    private readonly service: ConversionRequestService,
    private readonly orgContext: OrganizationContextService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a new conversion request (Managed Modernization Services workflow)' })
  async submitRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader: string | undefined,
    @Body() dto: CreateConversionRequestDto,
  ) {
    const org = await this.orgContext.resolve(user.userId, organizationHeader);
    return this.service.create(
      dto,
      { userId: user.userId, email: user.email },
      org.id,
    );
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get partner organization workspace metrics & statistics' })
  async getMetrics(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader: string | undefined,
  ) {
    const org = await this.orgContext.resolve(user.userId, organizationHeader);
    return this.service.getWorkspaceMetrics(org.id);
  }

  @Get()
  @ApiOperation({ summary: 'List conversion requests for current organization, or all organizations for Admin' })
  async listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader: string | undefined,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    let orgId: string | undefined;
    if (!user.isPlatformAdmin || organizationHeader?.trim()) {
      const org = await this.orgContext.resolve(user.userId, organizationHeader);
      orgId = org.id;
    }
    return this.service.listOrganizationRequests(orgId, {
      status,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversion request details' })
  async getRequestById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader: string | undefined,
  ) {
    let orgId: string | undefined;
    if (!user.isPlatformAdmin) {
      const org = await this.orgContext.resolve(user.userId, organizationHeader);
      orgId = org.id;
    }
    return this.service.getById(id, orgId);
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Admin review: accept, reject, or mark under review' })
  async reviewRequest(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReviewConversionRequestDto,
  ) {
    return this.service.reviewRequest(
      id,
      dto,
      { userId: user.userId, email: user.email },
    );
  }

  @Post(':id/create-project')
  @ApiOperation({ summary: 'Spawn execution project from approved conversion request' })
  async createProject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createProjectFromRequest(id, {
      userId: user.userId,
      email: user.email,
    });
  }
}
