export interface IRole {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPermission {
  key: string;
  label: string;
  group: string;
  description: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IRbacUser {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
}

export interface IRbacRepository {
  findRoles(): Promise<IRole[]>;
  findRoleById(id: string): Promise<IRole | null>;
  createRole(data: { id: string; name: string; description: string; isSystem: boolean }): Promise<IRole>;
  updateRole(id: string, data: { name?: string; description?: string }): Promise<IRole | null>;
  deleteRole(id: string): Promise<void>;
  countUsersWithRole(roleId: string): Promise<number>;
  deleteRolePermissionsByRoleId(roleId: string): Promise<void>;
  deleteUserRolesByRoleId(roleId: string): Promise<void>;

  findPermissions(): Promise<IPermission[]>;
  findPermissionByKey(key: string): Promise<IPermission | null>;
  createPermission(data: { key: string; label: string; group: string; description: string }): Promise<IPermission>;
  updatePermission(key: string, data: { label?: string; group?: string; description?: string }): Promise<IPermission | null>;
  deletePermission(key: string): Promise<void>;
  deleteRolePermissionsByPermissionKey(permissionKey: string): Promise<void>;

  findRolePermissions(roleId: string): Promise<string[]>;
  findRolePermissionsByRoleIds(roleIds: string[]): Promise<string[]>;
  findAllRolePermissions(): Promise<Array<{ roleId: string; permissionKey: string }>>;
  updateRolePermissions(roleId: string, permissionKeys: string[]): Promise<string[]>;

  findUserRoles(userId: string): Promise<string[]>;
  findAllUserRoles(): Promise<Array<{ userId: string; roleId: string }>>;
  updateUserRoles(userId: string, roleIds: string[]): Promise<string[]>;

  findUserById(userId: string): Promise<IRbacUser | null>;
  findAllUsers(): Promise<IRbacUser[]>;
  findValidPermissions(keys: string[]): Promise<string[]>;
  findValidRoles(ids: string[]): Promise<string[]>;
}

export const RBAC_REPOSITORY = Symbol('RBAC_REPOSITORY');
