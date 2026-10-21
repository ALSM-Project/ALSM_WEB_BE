import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Role, RoleSchema } from './infrastructure/schemas/role.schema';
import { Permission, PermissionSchema } from './infrastructure/schemas/permission.schema';
import { UserRole, UserRoleSchema } from './infrastructure/schemas/user-role.schema';
import {
  RolePermission,
  RolePermissionSchema,
} from './infrastructure/schemas/role-permission.schema';
import { User, UserSchema } from '../users/infrastructure/user.schema';
import { MenuItem, MenuItemSchema } from '../menus/infrastructure/schemas/menu-item.schema';
import {
  MenuItemPermission,
  MenuItemPermissionSchema,
} from '../menus/infrastructure/schemas/menu-item-permission.schema';
import { RbacService } from './application/rbac.service';
import { EffectivePermissionsService } from './application/effective-permissions.service';
import { RbacSeedService } from './application/rbac-seed.service';
import { TemporaryRoleService } from './application/temporary-role.service';
import { RbacController } from './presentation/rbac.controller';
import { TemporaryRoleController } from './presentation/temporary-role.controller';
import { RBAC_REPOSITORY } from './domain/rbac.repository.interface';
import { MongoRbacRepository } from './infrastructure/persistence/mongo-rbac.repository';
import { TemporaryRole, TemporaryRoleSchema } from './infrastructure/schemas/temporary-role.schema';

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
      { name: TemporaryRole.name, schema: TemporaryRoleSchema },
    ]),
  ],
  controllers: [RbacController, TemporaryRoleController],
  providers: [
    MongoRbacRepository,
    {
      provide: RBAC_REPOSITORY,
      useExisting: MongoRbacRepository,
    },
    RbacService,
    EffectivePermissionsService,
    RbacSeedService,
    TemporaryRoleService,
  ],
  exports: [RBAC_REPOSITORY, RbacService, EffectivePermissionsService, TemporaryRoleService],
})
export class RbacModule {}
