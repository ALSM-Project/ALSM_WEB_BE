import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MenuBuilderService } from '../../application/services/menu-builder.service';
import {
  CreateMenuItemDto,
  MoveMenuItemDto,
  ReorderMenuItemsDto,
  UpdateMenuItemDto,
} from '../dto/menu.dto';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';
import { ApplicationContext } from '../../domain/enums/menu.enums';

@ApiTags('Menu Builder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller(['menu-items', 'admin/menus'])
export class MenuBuilderController {
  constructor(private readonly menuBuilderService: MenuBuilderService) {}

  @Get()
  @RequirePermissions('menu.view')
  @ApiQuery({ name: 'application', enum: ApplicationContext, required: false })
  async getMenuTree(@Query('application') application?: ApplicationContext) {
    const app = application || ApplicationContext.WEB_2;
    return this.menuBuilderService.getAdminMenuTree(app);
  }

  @Get(':id')
  @RequirePermissions('menu.view')
  async getMenuItem(@Param('id') id: string) {
    return this.menuBuilderService.getMenuItemById(id);
  }

  @Post()
  @RequirePermissions('menu.manage')
  async createMenuItem(
    @Body() dto: CreateMenuItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.menuBuilderService.createMenuItem(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermissions('menu.manage')
  async updateMenuItem(
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.menuBuilderService.updateMenuItem(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('menu.manage')
  async deleteMenuItem(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.menuBuilderService.deleteMenuItem(id, user.userId);
    return { success: true };
  }

  @Post('reorder')
  @RequirePermissions('menu.manage')
  async reorderMenuItems(
    @Body() dto: ReorderMenuItemsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.menuBuilderService.reorderMenuItems(dto.items, user.userId);
    return { success: true };
  }

  @Post(':id/move')
  @RequirePermissions('menu.manage')
  async moveMenuItem(
    @Param('id') id: string,
    @Body() dto: MoveMenuItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.menuBuilderService.moveMenuItem(
      id,
      dto.parentId !== undefined ? dto.parentId : null,
      dto.targetOrder,
      dto.targetId,
      dto.placement,
      user.userId,
    );
  }
}
