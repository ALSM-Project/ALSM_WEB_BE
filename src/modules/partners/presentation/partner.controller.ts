import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CreatePartnerService } from '../application/create-partner.service';
import { ListPartnersService } from '../application/list-partners.service';
import { CreatePartnerDto } from './partner.dto';

@ApiTags('Partners (UC-44)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('partners')
export class PartnerController {
  constructor(
    private readonly createPartnerService: CreatePartnerService,
    private readonly listPartnersService: ListPartnersService,
  ) {}

  @Get()
  @RequirePermissions('partners.view')
  @ApiOperation({ summary: 'List partner profiles', description: 'Requires partners.view permission.' })
  @ApiResponse({ status: 200, description: 'Partner profiles retrieved successfully' })
  async list() {
    return this.listPartnersService.execute();
  }

  @Post()
  @RequirePermissions('partners.manage')
  @ApiOperation({ summary: 'Create a partner profile', description: 'Requires partners.manage permission.' })
  @ApiResponse({ status: 201, description: 'Partner profile created successfully' })
  @ApiResponse({ status: 409, description: 'A partner with this contact email already exists' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePartnerDto) {
    return this.createPartnerService.execute(user.userId, dto);
  }
}
