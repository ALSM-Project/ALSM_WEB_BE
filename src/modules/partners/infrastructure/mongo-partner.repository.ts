import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Partner, PartnerDocument } from './partner.schema';
import {
  CreatePartnerInput,
  DuplicatePartnerEmailError,
  PartnerListFilter,
  PartnerRecord,
  PartnerRepository,
  PartnerStatus,
} from '../domain/partner.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

const DUPLICATE_KEY_ERROR = 11000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class MongoPartnerRepository implements PartnerRepository {
  constructor(@InjectModel(Partner.name) private readonly model: Model<Partner>) {}

  async findByEmail(contactEmail: string): Promise<PartnerRecord | null> {
    const doc = await this.model
      .findOne({ contactEmail: contactEmail.trim().toLowerCase() })
      .exec();
    return doc ? this.map(doc) : null;
  }

  async create(input: CreatePartnerInput): Promise<PartnerRecord> {
    try {
      const doc = await this.model.create({
        name: input.name,
        contactEmail: input.contactEmail.toLowerCase(),
        contactName: input.contactName,
        primaryDomain: input.primaryDomain,
        engagementType: input.engagementType,
        assignedStaffName: input.assignedStaffName,
        status: PartnerStatus.ACTIVE,
        createdBy: toValidObjectId(input.createdBy),
      });
      return this.map(doc);
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY_ERROR) {
        throw new DuplicatePartnerEmailError(input.contactEmail);
      }
      throw error;
    }
  }

  async list(filter: PartnerListFilter = {}): Promise<PartnerRecord[]> {
    const query: FilterQuery<Partner> = {};
    if (filter.status) query.status = filter.status;
    const search = filter.search?.trim();
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ name: pattern }, { contactEmail: pattern }, { primaryDomain: pattern }];
    }
    const docs = await this.model.find(query).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.map(doc));
  }

  private map(doc: PartnerDocument): PartnerRecord {
    return {
      id: doc.id,
      name: doc.name,
      contactEmail: doc.contactEmail,
      contactName: doc.contactName,
      primaryDomain: doc.primaryDomain,
      engagementType: doc.engagementType,
      assignedStaffName: doc.assignedStaffName,
      status: doc.status,
      completedExportCount: doc.completedExportCount ?? 0,
      latestActivity: doc.latestActivity,
      createdBy: doc.createdBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
