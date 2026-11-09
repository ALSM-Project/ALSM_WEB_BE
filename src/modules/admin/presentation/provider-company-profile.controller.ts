import {
  Body,
  Controller,
  Get,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { ProviderCompanyProfileService } from '../application/provider-company-profile.service';
import { UpdateProviderCompanyProfileDto } from './dto/provider-company-profile.dto';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

@ApiTags('Company Profile Settings')
@Controller()
export class ProviderCompanyProfileController {
  constructor(private readonly profileService: ProviderCompanyProfileService) {}

  @Get('company-profile')
  @ApiOperation({ summary: 'Get active ALSM Provider Legal Profile (Public / System)' })
  async getActiveProfilePublic() {
    return this.profileService.getActiveProfile();
  }

  @Get('admin/company-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin view of active ALSM Provider Legal Profile' })
  async getActiveProfileAdmin() {
    return this.profileService.getActiveProfile();
  }

  @Get('admin/company-profile/versions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all historical versions of ALSM Provider Legal Profile' })
  async getProfileVersions() {
    return this.profileService.getProfileVersions();
  }

  @Put('admin/company-profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update ALSM Provider Legal & Billing Profile' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProviderCompanyProfileDto,
    @Req() req: Request,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    return this.profileService.updateProfile(dto, user?.userId, user?.email, ipAddress);
  }
}
