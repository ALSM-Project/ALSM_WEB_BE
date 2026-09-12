import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MenuItem, MenuItemSchema } from './infrastructure/schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionSchema } from './infrastructure/schemas/menu-item-permission.schema';
import { Menu, MenuSchema } from './infrastructure/schemas/menu.schema';
import { UserPreferences, UserPreferencesSchema } from './infrastructure/schemas/user-preferences.schema';
import { MenuAnalytics, MenuAnalyticsSchema } from './infrastructure/schemas/menu-analytics.schema';
import { NavigationService } from './application/services/navigation.service';
import { MenuBuilderService } from './application/services/menu-builder.service';
import { GetPersonalizedMenuService } from './application/services/get-personalized-menu.service';
import { MenuPersonalizationService } from './application/services/personalization.service';
import { CommandPaletteService } from './application/services/command-palette.service';
import { MenuAnalyticsService } from './application/services/menu-analytics.service';
import { NavigationController } from './presentation/controllers/navigation.controller';
import { MenuBuilderController } from './presentation/controllers/menu-builder.controller';
import { MenuController } from './presentation/controllers/menu.controller';
import { CommandPaletteController } from './presentation/controllers/command-palette.controller';
import { RbacModule } from '../rbac/rbac.module';
import {
  MENU_REPOSITORY,
  USER_PREFERENCES_REPOSITORY,
} from './domain/interfaces/menu.repository.interface';
import { MongoMenuRepository } from './infrastructure/persistence/mongo-menu.repository';
import { MongoUserPreferencesRepository } from './infrastructure/persistence/mongo-user-preferences.repository';

import { Permission, PermissionSchema } from '../rbac/infrastructure/schemas/permission.schema';

@Module({
  imports: [
    RbacModule,
    MongooseModule.forFeature([
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: MenuItemPermission.name, schema: MenuItemPermissionSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: Menu.name, schema: MenuSchema },
      { name: UserPreferences.name, schema: UserPreferencesSchema },
      { name: MenuAnalytics.name, schema: MenuAnalyticsSchema },
    ]),
  ],

  controllers: [
    NavigationController,
    MenuBuilderController,
    MenuController,
    CommandPaletteController,
  ],
  providers: [
    NavigationService,
    MenuBuilderService,
    GetPersonalizedMenuService,
    MenuPersonalizationService,
    CommandPaletteService,
    MenuAnalyticsService,
    MongoMenuRepository,
    MongoUserPreferencesRepository,
    { provide: MENU_REPOSITORY, useClass: MongoMenuRepository },
    { provide: USER_PREFERENCES_REPOSITORY, useClass: MongoUserPreferencesRepository },
  ],
  exports: [NavigationService, MenuBuilderService],
})
export class MenuModule {}
