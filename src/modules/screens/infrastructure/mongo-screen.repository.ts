import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Screen, ScreenDocument } from './screen.schema';
import { ScreenRecord, ScreenRepository, ScreenStatus } from '../domain/screen.types';

@Injectable()
export class MongoScreenRepository implements ScreenRepository {
  constructor(@InjectModel(Screen.name) private readonly model: Model<Screen>) {}

  async create(input: Omit<ScreenRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ScreenRecord> {
    return this.map(
      await this.model.create({
        ...input,
        organizationId: new Types.ObjectId(input.organizationId),
        projectId: new Types.ObjectId(input.projectId),
        createdBy: new Types.ObjectId(input.createdBy),
      }),
    );
  }

  async findById(id: string, organizationId: string): Promise<ScreenRecord | null> {
    const doc = await this.model.findOne({ _id: id, organizationId }).exec();
    return doc ? this.map(doc) : null;
  }

  async listByProject(projectId: string, organizationId: string): Promise<ScreenRecord[]> {
    return (
      await this.model.find({ projectId, organizationId }).sort({ createdAt: -1 }).exec()
    ).map((doc) => this.map(doc));
  }

  async updateStatus(id: string, organizationId: string, status: ScreenStatus): Promise<void> {
    await this.model.updateOne({ _id: id, organizationId }, { $set: { status } }).exec();
  }

  async delete(id: string): Promise<void> {
    let screen: ScreenDocument | null = null;
    if (Types.ObjectId.isValid(id)) {
      screen = await this.model.findById(id).exec();
    }
    if (!screen) {
      screen = await this.model.findOne({ $or: [{ name: id }, { inputReference: id }] }).exec();
    }
    if (screen) {
      await this.model.deleteMany({
        $or: [{ _id: screen._id }, { name: screen.name }, { inputReference: screen.inputReference }],
      }).exec();
    } else {
      const deleteConditions: Record<string, any>[] = [{ name: id }, { inputReference: id }];
      if (Types.ObjectId.isValid(id)) {
        deleteConditions.push({ _id: id });
      }
      await this.model.deleteMany({ $or: deleteConditions }).exec();
    }
  }

  private map(doc: ScreenDocument): ScreenRecord {
    return {
      id: doc.id,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      name: doc.name,
      sourceType: doc.sourceType,
      status: doc.status,
      inputReference: doc.inputReference,
      sizeBytes: doc.sizeBytes,
      createdBy: doc.createdBy.toString(),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }
}
