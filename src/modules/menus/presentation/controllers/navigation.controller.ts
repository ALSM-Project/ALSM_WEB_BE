import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { NavigationService } from '../../application/services/navigation.service';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';
import { ApplicationContext } from '../../domain/enums/menu.enums';

@ApiTags('Navigation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('navigation')
export class NavigationController {
  constructor(private readonly navigationService: NavigationService) {}

  @Get()
  @ApiQuery({ name: 'application', enum: ApplicationContext, required: false })
  async getNavigation(
    @CurrentUser() user: AuthenticatedUser,
    @Query('application') application?: ApplicationContext,
  ) {
    const app = application || ApplicationContext.WEB_2;
    return this.navigationService.getUserNavigation(user.userId, app);
  }
}
