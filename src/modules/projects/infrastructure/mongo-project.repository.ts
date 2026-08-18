import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from './project.schema';
import { ProjectRecord, ProjectRepository } from '../domain/project.types';
@Injectable()
export class MongoProjectRepository implements ProjectRepository {
  constructor(@InjectModel(Project.name) private readonly model: Model<Project>) {}
  async create(input: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectRecord> { return this.map(await this.model.create({ ...input, organizationId: new Types.ObjectId(input.organizationId), createdBy: new Types.ObjectId(input.createdBy) })); }
  async findById(id: string, organizationId: string): Promise<ProjectRecord | null> { const doc = await this.model.findOne({ _id: id, organizationId, deletedAt: { $exists: false } }).exec(); return doc ? this.map(doc) : null; }
  async findAll(organizationId: string): Promise<ProjectRecord[]> { return (await this.model.find({ organizationId, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).exec()).map((doc) => this.map(doc)); }
  async update(id: string, organizationId: string, input: Partial<Pick<ProjectRecord, 'name' | 'description' | 'status'>>): Promise<ProjectRecord | null> { const doc = await this.model.findOneAndUpdate({ _id: id, organizationId, deletedAt: { $exists: false } }, { $set: input }, { new: true }).exec(); return doc ? this.map(doc) : null; }
  async softDelete(id: string, organizationId: string): Promise<boolean> { const result = await this.model.updateOne({ _id: id, organizationId, deletedAt: { $exists: false } }, { $set: { deletedAt: new Date() } }).exec(); return result.modifiedCount === 1; }
  private map(doc: ProjectDocument): ProjectRecord { return { id: doc.id, organizationId: doc.organizationId.toString(), name: doc.name, description: doc.description, conversionType: doc.conversionType, status: doc.status, createdBy: doc.createdBy.toString(), createdAt: doc.createdAt, updatedAt: doc.updatedAt, deletedAt: doc.deletedAt }; }
}
