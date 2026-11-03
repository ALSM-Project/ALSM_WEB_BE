import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  SupportOrganizationDirectory,
  SupportOrganizationMetadata,
  SupportOrganizationSearch,
} from '../domain/support-organization-directory.port';
import { OrganizationType } from '../domain/organization.types';
import { Organization } from './organization.schema';

@Injectable()
export class MongoSupportOrganizationDirectory implements SupportOrganizationDirectory {
  constructor(@InjectModel(Organization.name) private readonly model: Model<Organization>) {}

  async search(
    input: SupportOrganizationSearch,
    now: Date,
  ): Promise<SupportOrganizationMetadata[]> {
    const literal = input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(input.field === 'email' ? `^${literal}$` : `^${literal}`, 'i');
    const docs = await this.model
      .find({
        ...this.eligibleFilter(now),
        [input.field === 'email' ? 'contactEmail' : 'name']: match,
        ...(input.afterId ? { _id: { $gt: new Types.ObjectId(input.afterId) } } : {}),
      })
      .select('_id name type status')
      .sort({ _id: 1 })
      .limit(input.limit + 1)
      .maxTimeMS(2000)
      .read('primary')
      .lean()
      .exec();
    return docs.map((doc) => this.metadata(doc));
  }

  async eligible(id: string, now: Date): Promise<SupportOrganizationMetadata | null> {
    const doc = await this.model
      .findOne({ _id: new Types.ObjectId(id), ...this.eligibleFilter(now) })
      .select('_id name type status')
      .read('primary')
      .lean()
      .exec();
    return doc ? this.metadata(doc) : null;
  }

  private eligibleFilter(now: Date): FilterQuery<Organization> {
    return {
      type: { $in: [OrganizationType.SELF_SERVICE, OrganizationType.ENTERPRISE] },
      $or: [{ status: 'ACTIVE' }, { status: 'TRIAL', trialExpiresAt: { $gt: now } }],
    };
  }

  private metadata(doc: {
    _id: Types.ObjectId;
    name: string;
    type: OrganizationType;
    status: string;
  }): SupportOrganizationMetadata {
    if (!['ACTIVE', 'TRIAL'].includes(doc.status) || typeof doc.name !== 'string')
      throw new Error('Invalid Organisation search metadata');
    return {
      id: String(doc._id),
      name: doc.name,
      type: doc.type,
      status: doc.status as 'ACTIVE' | 'TRIAL',
    };
  }
}
