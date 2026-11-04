import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CreatePartnerService } from '../application/create-partner.service';
import { ListPartnersService } from '../application/list-partners.service';
import { CreatePartnerDto, ListPartnersQueryDto } from './partner.dto';

@ApiTags('Partners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('partners')
export class PartnerController {
  constructor(
    private readonly createPartnerService: CreatePartnerService,
    private readonly listPartnersService: ListPartnersService,
  ) {}

  @Get()
  @RequirePermissions('partner.view')
  @ApiOperation({ summary: 'List partner profiles (newest first)' })
  @ApiResponse({ status: 200, description: 'Partner profiles retrieved successfully' })
  async list(@Query() query: ListPartnersQueryDto) {
    return this.listPartnersService.execute({ status: query.status, search: query.search });
  }

  @Post()
  @RequirePermissions('partner.create')
  @ApiOperation({ summary: 'Create a partner profile (UC-44)' })
  @ApiResponse({ status: 201, description: 'Partner profile created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or missing partner data' })
  @ApiResponse({ status: 409, description: 'A partner with this contact email already exists' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerDto) {
    return this.createPartnerService.execute(user.userId, dto);
  }
}
