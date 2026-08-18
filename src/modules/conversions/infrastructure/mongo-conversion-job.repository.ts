import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversionJob, ConversionJobDocument } from './conversion-job.schema';
import { ConversionJobRecord, ConversionJobRepository, ConversionJobStatus } from '../domain/conversion-job.types';
@Injectable()
export class MongoConversionJobRepository implements ConversionJobRepository {
  constructor(@InjectModel(ConversionJob.name) private readonly model: Model<ConversionJob>) {}
  async create(input: Omit<ConversionJobRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ConversionJobRecord> { return this.map(await this.model.create({ ...input, organizationId: new Types.ObjectId(input.organizationId), projectId: new Types.ObjectId(input.projectId), createdBy: new Types.ObjectId(input.createdBy) })); }
  async findById(id: string, organizationId: string): Promise<ConversionJobRecord | null> { const doc = await this.model.findOne({ _id: id, organizationId }).exec(); return doc ? this.map(doc) : null; }
  async findByIdAnyOrganization(id: string): Promise<ConversionJobRecord | null> { const doc = await this.model.findById(id).exec(); return doc ? this.map(doc) : null; }
  async listByProject(projectId: string, organizationId: string): Promise<ConversionJobRecord[]> { return (await this.model.find({ projectId, organizationId }).sort({ createdAt: -1 }).exec()).map((doc) => this.map(doc)); }
  async retry(id: string, organizationId: string): Promise<ConversionJobRecord | null> { const doc = await this.model.findOneAndUpdate({ _id: id, organizationId, status: { $in: [ConversionJobStatus.FAILED, ConversionJobStatus.DEAD] } }, { $set: { status: ConversionJobStatus.QUEUED, errorCode: undefined, errorMessage: undefined, completedAt: undefined, startedAt: undefined }, $inc: { attemptCount: 1 } }, { new: true }).exec(); return doc ? this.map(doc) : null; }
  async markProcessing(id: string): Promise<ConversionJobRecord | null> { const doc = await this.model.findOneAndUpdate({ _id: id, status: ConversionJobStatus.QUEUED }, { $set: { status: ConversionJobStatus.PROCESSING, startedAt: new Date() } }, { new: true }).exec(); return doc ? this.map(doc) : null; }
  async markFailed(id: string, code: string, message: string): Promise<void> { await this.model.updateOne({ _id: id }, { $set: { status: ConversionJobStatus.FAILED, errorCode: code, errorMessage: message, completedAt: new Date() } }).exec(); }
  private map(doc: ConversionJobDocument): ConversionJobRecord { return { id: doc.id, organizationId: doc.organizationId.toString(), projectId: doc.projectId.toString(), conversionType: doc.conversionType, status: doc.status, priority: doc.priority, attemptCount: doc.attemptCount, maxAttempts: doc.maxAttempts, inputReference: doc.inputReference, resultReference: doc.resultReference, errorCode: doc.errorCode, errorMessage: doc.errorMessage, toolVersion: doc.toolVersion, createdBy: doc.createdBy.toString(), createdAt: doc.createdAt, updatedAt: doc.updatedAt, startedAt: doc.startedAt, completedAt: doc.completedAt }; }
}
