import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  InternalWorkingFileDocument,
  WorkingFileCategory,
} from '../infrastructure/internal-working-file.schema';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';

export interface InternalWorkingFileDto {
  name: string;
  category: WorkingFileCategory;
  sizeBytes?: number;
  content?: string;
  notes?: string;
}

@Injectable()
export class InternalWorkingFileService {
  constructor(
    @InjectModel(InternalWorkingFileDocument.name)
    private readonly fileModel: Model<InternalWorkingFileDocument>,
  ) {}

  async listForProject(
    projectId: string,
  ): Promise<InternalWorkingFileDocument[]> {
    if (!Types.ObjectId.isValid(projectId)) {
      return [];
    }
    return this.fileModel
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async create(
    projectId: string,
    organizationId: string,
    dto: InternalWorkingFileDto,
    user: AuthenticatedUser,
  ): Promise<InternalWorkingFileDocument> {
    const doc = new this.fileModel({
      projectId: new Types.ObjectId(projectId),
      organizationId: Types.ObjectId.isValid(organizationId)
        ? new Types.ObjectId(organizationId)
        : new Types.ObjectId('66d99ec12871af85557f89b1'),
      name: dto.name,
      category: dto.category,
      sizeBytes: dto.sizeBytes || (dto.content ? Buffer.byteLength(dto.content, 'utf8') : 1024),
      content: dto.content,
      uploadedByUserId: user.userId,
      uploadedByName: user.email || 'ALSM Engineer',
      uploadedByRole: (user.roles && user.roles[0]) || 'STAFF',
      notes: dto.notes,
    });
    return doc.save();
  }

  async delete(id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Working file not found');
    }
    const result = await this.fileModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Working file not found');
    }
    return true;
  }
}
