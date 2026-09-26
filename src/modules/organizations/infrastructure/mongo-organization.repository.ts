import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Organization, OrganizationDocument } from './organization.schema';
import { OrganizationRecord, OrganizationRepository } from '../domain/organization.repository';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoOrganizationRepository implements OrganizationRepository {
  constructor(@InjectModel(Organization.name) private readonly model: Model<Organization>) {}

  async create(input: Pick<OrganizationRecord, 'name' | 'type' | 'members'>): Promise<OrganizationRecord> {
    return this.map(
      await this.model.create({
        ...input,
        members: input.members.map((member) => ({
          ...member,
          userId: toValidObjectId(member.userId),
        })),
      }),
    );
  }

  async findForMember(organizationId: string, userId: string): Promise<OrganizationRecord | null> {
    const orgObjId = toValidObjectId(organizationId);
    const userObjId = toValidObjectId(userId);

    let doc = await this.model
      .findOne({
        $or: [{ _id: orgObjId }, { _id: organizationId }],
        'members.userId': { $in: [userObjId, userId] },
      })
      .exec();

    if (!doc) {
      doc = await this.model
        .findOne({
          'members.userId': { $in: [userObjId, userId] },
        })
        .exec();
    }

    if (!doc) {
      doc = await this.model.create({
        name: `User Workspace`,
        type: 'ENTERPRISE',
        members: [{ userId: userObjId, role: 'OWNER' }],
      });
    }

    return this.map(doc);
  }

  async findFirstForMember(userId: string): Promise<OrganizationRecord | null> {
    const userObjId = toValidObjectId(userId);
    let doc = await this.model
      .findOne({
        'members.userId': { $in: [userObjId, userId] },
      })
      .exec();
    if (!doc) {
      doc = await this.model.create({
        name: `Personal Workspace`,
        type: 'ENTERPRISE',
        members: [{ userId: userObjId, role: 'OWNER' }],
      });
    }
    return this.map(doc);
  }

  private map(doc: OrganizationDocument): OrganizationRecord {
    return {
      id: doc.id,
      name: doc.name,
      type: doc.type,
      members: doc.members.map((member) => ({
        userId: member.userId.toString(),
        role: member.role,
      })),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}

