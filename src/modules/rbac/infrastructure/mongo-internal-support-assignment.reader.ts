import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IRbacRepository, RBAC_REPOSITORY } from '../domain/rbac.repository.interface';
import { InternalSupportAssignmentPort } from '../domain/internal-support-assignment.port';
import { TemporaryRole } from './schemas/temporary-role.schema';

/** No permission expansion and no fallback on unavailable temporary-role storage. */
@Injectable()
export class MongoInternalSupportAssignmentReader implements InternalSupportAssignmentPort {
  constructor(
    @Inject(RBAC_REPOSITORY) private readonly rbac: IRbacRepository,
    @InjectModel(TemporaryRole.name) private readonly temporaryRoles: Model<TemporaryRole>,
  ) {}

  async hasCurrentAssignment(userId: string): Promise<boolean> {
    if (!/^[a-f0-9]{24}$/.test(userId)) throw new Error('Invalid role subject');
    const roles = await this.rbac.findUserRoles(userId);
    if (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string'))
      throw new Error('Unverifiable role assignments');
    if (roles.includes('INTERNAL_SUPPORT')) return true;
    return (
      (await this.temporaryRoles
        .exists({
          userId: new Types.ObjectId(userId),
          roleId: 'INTERNAL_SUPPORT',
          status: 'ACTIVE',
          expiresAt: { $gt: new Date() },
        })
        .exec()) !== null
    );
  }
}
