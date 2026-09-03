import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';
import { GetPersonalizedMenuService } from '../../application/services/get-personalized-menu.service';
import { MenuPersonalizationService } from '../../application/services/personalization.service';
import { MenuAnalyticsService } from '../../application/services/menu-analytics.service';
import { MenuPresenter } from '../response/menu.presenter';

@ApiTags('Menus')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('menus')
export class MenuController {
  constructor(
    private readonly getPersonalizedMenuService: GetPersonalizedMenuService,
    private readonly personalizationService: MenuPersonalizationService,
    private readonly analyticsService: MenuAnalyticsService,
  ) {}

  @Get('personalized')
  @ApiOperation({ summary: 'Get personalized menu structure for current user' })
  @ApiResponse({ status: 200, description: 'Personalized menu structure' })
  async getPersonalizedMenu(
    @CurrentUser() user: AuthenticatedUser,
    @Query('deviceType') deviceType?: 'desktop' | 'tablet' | 'mobile',
  ) {
    const userRole = (user as any).role || 'user';
    const navigation = await this.getPersonalizedMenuService.execute(user.userId, {
      role: userRole,
      deviceType,
    });

    return MenuPresenter.toPersonalizedResponse(navigation);
  }

  @Post('pin/:itemId')
  @ApiOperation({ summary: 'Pin a menu item' })
  async pinItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
  ) {
    await this.personalizationService.pinMenuItem(user.userId, itemId);
    return { success: true, message: `Menu item ${itemId} pinned` };
  }

  @Post('unpin/:itemId')
  @ApiOperation({ summary: 'Unpin a menu item' })
  async unpinItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
  ) {
    await this.personalizationService.unpinMenuItem(user.userId, itemId);
    return { success: true, message: `Menu item ${itemId} unpinned` };
  }

  @Post('track/:itemId')
  @ApiOperation({ summary: 'Track menu item usage' })
  async trackUsage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('itemId') itemId: string,
    @Body() body?: { sessionId?: string; action?: 'click' | 'hover' | 'search' },
  ) {
    await this.personalizationService.trackMenuItemUsage(user.userId, itemId);
    await this.analyticsService.trackInteraction({
      userId: user.userId,
      menuItemId: itemId,
      action: body?.action || 'click',
      sessionId: body?.sessionId || 'default-session',
    });
    return { success: true };
  }

  @Get('analytics/suggestions')
  @ApiOperation({ summary: 'Get menu optimization suggestions' })
  async getSuggestions() {
    const suggestions = await this.analyticsService.suggestImprovements();
    return { success: true, data: suggestions };
  }
}
