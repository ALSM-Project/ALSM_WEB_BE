import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SUPPORT_STAFF_AUTHORITY } from './domain/support-staff-authority.port';
import { MongoSupportStaffAuthorityReader } from './infrastructure/mongo-support-staff-authority.reader';
import { Role, RoleSchema } from './infrastructure/schemas/role.schema';
import { Permission, PermissionSchema } from './infrastructure/schemas/permission.schema';
import { UserRole, UserRoleSchema } from './infrastructure/schemas/user-role.schema';
import {
  RolePermission,
  RolePermissionSchema,
} from './infrastructure/schemas/role-permission.schema';
import { TemporaryRole, TemporaryRoleSchema } from './infrastructure/schemas/temporary-role.schema';

/** Explicit public adapter for the isolated Support foundation; no role seeding. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: RolePermission.name, schema: RolePermissionSchema },
      { name: TemporaryRole.name, schema: TemporaryRoleSchema },
    ]),
  ],
  providers: [{ provide: SUPPORT_STAFF_AUTHORITY, useClass: MongoSupportStaffAuthorityReader }],
  exports: [SUPPORT_STAFF_AUTHORITY],
})
export class SupportStaffAuthorityModule {}
