export interface UserRecord { id: string; email: string; passwordHash: string; fullName: string; isPlatformAdmin: boolean; isActive: boolean; createdAt: Date; updatedAt: Date; }
export interface UserRepository { create(input: Pick<UserRecord, 'email' | 'passwordHash' | 'fullName'>): Promise<UserRecord>; findByEmail(email: string): Promise<UserRecord | null>; findById(id: string): Promise<UserRecord | null>; }
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
