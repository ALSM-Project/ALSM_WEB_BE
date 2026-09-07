import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MenuBuilderService } from '../../application/services/menu-builder.service';
import { CreateMenuItemDto, MoveMenuItemDto, ReorderMenuItemsDto, UpdateMenuItemDto } from '../dto/menu.dto';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../../shared/security/require-permissions.decorator';
import { ApplicationContext } from '../../infrastructure/schemas/menu-item.schema';

@ApiTags('Menu Builder')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('menu-items')
export class MenuBuilderController {
  constructor(private readonly menuBuilderService: MenuBuilderService) {}

  @Get()
  @RequirePermissions('menu.view')
  @ApiQuery({ name: 'application', enum: ApplicationContext, required: false })
  async getMenuTree(@Query('application') application?: ApplicationContext) {
    const app = application || ApplicationContext.WEB_2;
    return this.menuBuilderService.getAdminMenuTree(app);
  }

  @Post()
  @RequirePermissions('menu.manage')
  async createMenuItem(@Body() dto: CreateMenuItemDto) {
    return this.menuBuilderService.createMenuItem(dto);
  }

  @Patch(':id')
  @RequirePermissions('menu.manage')
  async updateMenuItem(@Param('id') id: string, @Body() dto: UpdateMenuItemDto) {
    return this.menuBuilderService.updateMenuItem(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('menu.manage')
  async deleteMenuItem(@Param('id') id: string) {
    await this.menuBuilderService.deleteMenuItem(id);
    return { success: true };
  }

  @Post('reorder')
  @RequirePermissions('menu.manage')
  async reorderMenuItems(@Body() dto: ReorderMenuItemsDto) {
    await this.menuBuilderService.reorderMenuItems(dto.items);
    return { success: true };
  }

  @Post(':id/move')
  @RequirePermissions('menu.manage')
  async moveMenuItem(@Param('id') id: string, @Body() dto: MoveMenuItemDto) {
    return this.menuBuilderService.moveMenuItem(id, dto.parentId ?? null, dto.targetOrder);
  }
}
