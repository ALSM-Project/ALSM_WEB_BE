import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { OrganizationLegalProfileService } from '../application/organization-legal-profile.service';
import { UpdateOrganizationLegalProfileDto } from './dto/organization-legal-profile.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('Tax ID Lookup & Customer Legal Profile')
@Controller()
export class TaxLookupController {
  constructor(private readonly legalProfileService: OrganizationLegalProfileService) {}

  @Get('tax-lookup/status')
  @ApiOperation({ summary: 'Get status of configured Tax ID lookup provider' })
  getTaxLookupStatus() {
    return this.legalProfileService.getTaxLookupStatus();
  }

  @Get('tax-lookup/:taxId')
  @ApiOperation({ summary: 'Lookup company information by Tax ID' })
  async lookupTaxId(@Param('taxId') taxId: string) {
    return this.legalProfileService.lookupTaxId(taxId);
  }

  @Get('organizations/:id/legal-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get Customer Organization Legal Profile' })
  async getLegalProfile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.legalProfileService.getLegalProfile(id, user?.userId);
  }

  @Put('organizations/:id/legal-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update Customer Organization Legal Profile' })
  async updateLegalProfile(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationLegalProfileDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    return this.legalProfileService.updateLegalProfile(id, dto, user.userId, ipAddress);
  }
}
