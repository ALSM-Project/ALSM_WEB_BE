import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiResponse } from '@nestjs/swagger';
import { NavigationService } from '../../application/services/navigation.service';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';

@ApiTags('Session')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('session')
export class SessionBootstrapController {
  constructor(private readonly navigationService: NavigationService) {}

  @Get('bootstrap')
  @ApiOperation({
    summary: 'Enterprise Session Bootstrap',
    description: 'Unified Big Tech bootstrap endpoint returning user, organization, active contract, quotas, and computed capabilities with stale-while-revalidate caching.',
  })
  @ApiResponse({ status: 200, description: 'Bootstrap data resolved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBootstrap(@CurrentUser() user: AuthenticatedUser) {
    return this.navigationService.getSessionBootstrap(user.userId, user?.email);
  }
}
