import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Partner, PartnerDocument } from './partner.schema';
import { CreatePartnerInput, PartnerRecord, PartnerRepository, PartnerStatus } from '../domain/partner.types';
import { toValidObjectId } from '../../../shared/utils/object-id.util';

@Injectable()
export class MongoPartnerRepository implements PartnerRepository {
  constructor(@InjectModel(Partner.name) private readonly model: Model<Partner>) {}

  async findByEmail(contactEmail: string): Promise<PartnerRecord | null> {
    const doc = await this.model.findOne({ contactEmail: contactEmail.toLowerCase() }).exec();
    return doc ? this.map(doc) : null;
  }

  async create(input: CreatePartnerInput): Promise<PartnerRecord> {
    const doc = await this.model.create({
      name: input.name,
      contactEmail: input.contactEmail.toLowerCase(),
      contactPhone: input.contactPhone,
      website: input.website,
      address: input.address,
      notes: input.notes,
      status: PartnerStatus.ACTIVE,
      createdBy: toValidObjectId(input.createdBy),
    });
    return this.map(doc);
  }

  async list(): Promise<PartnerRecord[]> {
    const docs = await this.model.find().sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.map(doc));
  }

  private map(doc: PartnerDocument): PartnerRecord {
    return {
      id: doc.id,
      name: doc.name,
      contactEmail: doc.contactEmail,
      contactPhone: doc.contactPhone,
      website: doc.website,
      address: doc.address,
      notes: doc.notes,
      status: doc.status,
      createdBy: doc.createdBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
