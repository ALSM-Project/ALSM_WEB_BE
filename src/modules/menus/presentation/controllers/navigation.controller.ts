import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NavigationService } from '../../application/services/navigation.service';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';
import { ApplicationContext } from '../../domain/enums/menu.enums';

@ApiTags('Navigation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller(['navigation', 'internal/navigation'])
export class NavigationController {
  constructor(private readonly navigationService: NavigationService) {}

  @Get()
  @ApiOperation({ summary: 'Get role and contract-governed dynamic navigation tree' })
  @ApiQuery({ name: 'application', enum: ApplicationContext, required: false })
  @ApiQuery({ name: 'contractType', required: false, description: 'Simulated contract type for preview' })
  @ApiQuery({ name: 'role', required: false, description: 'Simulated role for preview' })
  async getNavigation(
    @CurrentUser() user: AuthenticatedUser,
    @Query('application') application?: ApplicationContext,
    @Query('contractType') contractType?: string,
    @Query('role') role?: string,
  ) {
    const app = application || ApplicationContext.WEB_2;
    return this.navigationService.getUserNavigation(user.userId, app, { contractType, role });
  }

  @Get('contract-context')
  @ApiOperation({ summary: 'Get authoritative organization contract and service mode context' })
  async getContractContext(@CurrentUser() user: AuthenticatedUser) {
    return this.navigationService.getAuthoritativeContractContext(user.userId);
  }
}
