import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, HydratedDocument, Model, Types } from 'mongoose';
import { ContractTemplateRepository, ContractTemplateVersion } from '../domain/contract-template.types';
import { ContractTemplateVersionDocument } from './contract-template.schema';

@Injectable()
export class MongoContractTemplateRepository implements ContractTemplateRepository, OnModuleInit {
  private session?: ClientSession;

  constructor(
    @InjectModel(ContractTemplateVersionDocument.name) private readonly model: Model<ContractTemplateVersionDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async onModuleInit() {
    await this.model.init();
    const indexes = await this.model.collection.indexes();
    if (!indexes.some((index) => index.name === 'contract_template_version_unique' && index.unique === true)) {
      throw new ConflictException({ code: 'CONTRACT_TEMPLATE_INDEX_UNAVAILABLE', message: 'Contract template version safeguards are unavailable.' });
    }
  }

  inTransaction(session: ClientSession, connection: Connection): MongoContractTemplateRepository {
    if (this.model.db !== connection || this.connection !== connection) {
      throw new Error('Contract template repository must share the transaction connection.');
    }
    const repository = new MongoContractTemplateRepository(this.model, connection);
    repository.session = session;
    return repository;
  }

  async findApprovedById(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const row = await this.model.findOne({ _id: id, status: 'APPROVED' }).exec();
    return row ? this.map(row) : null;
  }

  async listApproved() {
    const rows = await this.model.find({ status: 'APPROVED' }).sort({ templateId: 1, versionNumber: -1 }).exec();
    const latestByTemplate = new Map<string, HydratedDocument<ContractTemplateVersionDocument>>();
    for (const row of rows) {
      if (!latestByTemplate.has(row.templateId)) latestByTemplate.set(row.templateId, row);
    }
    return [...latestByTemplate.values()].map((row) => this.map(row)).sort((a, b) => a.title.localeCompare(b.title));
  }

  async listAllVersions() {
    const rows = await this.model.find({}).sort({ updatedAt: -1, templateId: 1, versionNumber: -1 }).exec();
    return rows.map((row) => this.map(row));
  }

  async listByTemplateId(templateId: string) {
    const rows = await this.model.find({ templateId }).sort({ versionNumber: -1 }).exec();
    return rows.map((row) => this.map(row));
  }

  async latestVersion(templateId: string) {
    const row = await this.model.findOne({ templateId }).sort({ versionNumber: -1 }).exec();
    return row ? this.map(row) : null;
  }

  async createVersion(input: {
    templateId: string; versionNumber: number; title: string; locale: 'vi' | 'en' | 'vi-en';
    sections: ContractTemplateVersion['sections']; contentDigest: string; createdByUserId: string; now: Date;
  }) {
    this.assertTransaction();
    const row = await this.model.create([{
      templateId: input.templateId,
      versionNumber: input.versionNumber,
      title: input.title,
      locale: input.locale,
      sections: input.sections,
      contentDigest: input.contentDigest,
      createdByUserId: input.createdByUserId,
      status: 'DRAFT',
      createdAt: input.now,
      updatedAt: input.now,
    }], { session: this.session }).then(([created]) => created);
    return this.map(row);
  }

  async approve(input: { id: string; reviewerUserId: string; now: Date }) {
    this.assertTransaction();
    if (!Types.ObjectId.isValid(input.id)) return null;
    const row = await this.model.findOneAndUpdate(
      { _id: input.id, status: 'DRAFT', createdByUserId: { $ne: input.reviewerUserId } },
      { $set: { status: 'APPROVED', approvedByUserId: input.reviewerUserId, approvedAt: input.now } },
      { new: true, session: this.session },
    ).exec();
    return row ? this.map(row) : null;
  }

  async reject(input: { id: string; reviewerUserId: string; reason: string; now: Date }) {
    this.assertTransaction();
    if (!Types.ObjectId.isValid(input.id)) return null;
    const row = await this.model.findOneAndUpdate(
      { _id: input.id, status: 'DRAFT', createdByUserId: { $ne: input.reviewerUserId } },
      { $set: { status: 'REJECTED', rejectedByUserId: input.reviewerUserId, rejectedAt: input.now, rejectionReason: input.reason } },
      { new: true, session: this.session },
    ).exec();
    return row ? this.map(row) : null;
  }

  private assertTransaction() {
    if (!this.session?.inTransaction()) throw new Error('Contract template mutation requires a Mongo transaction.');
  }

  private map(row: HydratedDocument<ContractTemplateVersionDocument>): ContractTemplateVersion {
    return {
      id: String(row._id),
      templateId: row.templateId,
      versionNumber: row.versionNumber,
      title: row.title,
      locale: row.locale,
      sections: row.sections.map((section) => ({ heading: section.heading, body: section.body })),
      status: row.status,
      contentDigest: row.contentDigest,
      createdByUserId: row.createdByUserId,
      approvedByUserId: row.approvedByUserId,
      approvedAt: row.approvedAt,
      rejectedByUserId: row.rejectedByUserId,
      rejectedAt: row.rejectedAt,
      rejectionReason: row.rejectionReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
