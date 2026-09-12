import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from './infrastructure/schemas/role.schema';
import { Permission, PermissionSchema } from './infrastructure/schemas/permission.schema';
import { UserRole, UserRoleSchema } from './infrastructure/schemas/user-role.schema';
import { RolePermission, RolePermissionSchema } from './infrastructure/schemas/role-permission.schema';
import { User, UserSchema } from '../users/infrastructure/user.schema';
import { MenuItem, MenuItemSchema } from '../menus/infrastructure/schemas/menu-item.schema';
import { MenuItemPermission, MenuItemPermissionSchema } from '../menus/infrastructure/schemas/menu-item-permission.schema';
import { RbacService } from './application/rbac.service';
import { EffectivePermissionsService } from './application/effective-permissions.service';
import { SeedService } from './infrastructure/seed.service';
import { RbacController } from './presentation/rbac.controller';
import { RBAC_REPOSITORY } from './domain/rbac.repository.interface';
import { MongoRbacRepository } from './infrastructure/persistence/mongo-rbac.repository';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: RolePermission.name, schema: RolePermissionSchema },
      { name: User.name, schema: UserSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: MenuItemPermission.name, schema: MenuItemPermissionSchema },
    ]),
  ],
  controllers: [RbacController],
  providers: [
    MongoRbacRepository,
    {
      provide: RBAC_REPOSITORY,
      useExisting: MongoRbacRepository,
    },
    RbacService,
    EffectivePermissionsService,
    SeedService,
  ],
  exports: [RBAC_REPOSITORY, RbacService, EffectivePermissionsService, SeedService],
})
export class RbacModule {}
