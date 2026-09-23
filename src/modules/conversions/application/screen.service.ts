import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ScreenDocument, ScreenSourceType, ScreenStatus } from '../infrastructure/screen.schema';
import { ConversionJob, ConversionJobDocument } from '../infrastructure/conversion-job.schema';

export interface UploadedFileItem {
  originalname: string;
  size: number;
  buffer?: Buffer;
}

@Injectable()
export class ScreenService {
  constructor(
    @InjectModel(ScreenDocument.name)
    private readonly screenModel: Model<ScreenDocument>,
    @InjectModel(ConversionJob.name)
    private readonly conversionJobModel: Model<ConversionJobDocument>,
  ) {}

  async getScreensByProject(projectId: string) {
    const screens = await this.screenModel.find({ projectId }).sort({ createdAt: -1 }).exec();

    // Check completed conversion jobs
    const completedJobs = await this.conversionJobModel.find({ status: 'COMPLETED' }).exec();
    const completedIdentifiers = new Set<string>();
    for (const job of completedJobs) {
      if (job.screenId) completedIdentifiers.add(job.screenId);
      if (job.inputReference) completedIdentifiers.add(job.inputReference);
    }

    return screens.map((doc) => {
      const dto = this.toResponseDto(doc);
      if (
        dto.status === 'READY' &&
        (completedIdentifiers.has(doc._id.toString()) ||
          completedIdentifiers.has(doc.name) ||
          completedIdentifiers.has(doc.inputReference))
      ) {
        dto.status = 'COMPLETED';
      }
      return dto;
    });
  }

  async updateScreenStatus(screenId: string, status: ScreenStatus) {
    if (Types.ObjectId.isValid(screenId)) {
      await this.screenModel.updateOne({ _id: screenId }, { status }).exec();
    }
    await this.screenModel
      .updateMany(
        { $or: [{ name: screenId }, { inputReference: screenId }] },
        { status },
      )
      .exec();
  }

  async getScreenById(screenId: string) {
    let screen: ScreenDocument | null = null;
    if (Types.ObjectId.isValid(screenId)) {
      screen = await this.screenModel.findById(screenId).exec();
    }
    if (!screen) {
      screen = await this.screenModel
        .findOne({
          $or: [{ name: screenId }, { inputReference: screenId }],
        })
        .exec();
    }
    if (!screen) {
      throw new NotFoundException({
        code: 'SCREEN_NOT_FOUND',
        message: `Screen with identifier ${screenId} was not found`,
      });
    }
    return this.toResponseDto(screen);
  }

  async uploadConversionSources(projectId: string, files: UploadedFileItem[]) {
    const inputReference = `ref-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const savedScreens = [];

    for (const file of files) {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      let sourceType: ScreenSourceType = 'BMS';
      if (ext === 'dspf') sourceType = 'DSPF';
      else if (['cob', 'cbl', 'cpy'].includes(ext ?? '')) sourceType = 'COBOL';

      const content = file.buffer ? file.buffer.toString('utf-8') : '';

      const doc = await this.screenModel.create({
        projectId,
        name: file.originalname,
        sourceType,
        status: 'READY',
        inputReference,
        sizeBytes: file.size,
        content,
      });

      savedScreens.push(this.toResponseDto(doc));
    }

    return {
      inputReference,
      files: files.map((f) => ({ name: f.originalname, sizeBytes: f.size })),
      screens: savedScreens,
    };
  }

  async deleteScreen(projectId: string, screenId: string) {
    let screen: ScreenDocument | null = null;
    if (Types.ObjectId.isValid(screenId)) {
      screen = await this.screenModel.findById(screenId).exec();
    }
    if (!screen) {
      screen = await this.screenModel
        .findOne({
          $or: [{ name: screenId }, { inputReference: screenId }],
        })
        .exec();
    }
    if (screen) {
      await this.screenModel.deleteOne({ _id: screen._id }).exec();
    } else if (Types.ObjectId.isValid(screenId)) {
      await this.screenModel.deleteOne({ _id: screenId }).exec();
    }
    return { deleted: true, id: screenId };
  }

  private toResponseDto(doc: ScreenDocument) {
    const rawDoc = doc as unknown as { createdAt?: Date; updatedAt?: Date };
    return {
      id: doc._id.toString(),
      projectId: doc.projectId,
      name: doc.name,
      sourceType: doc.sourceType,
      status: doc.status,
      inputReference: doc.inputReference,
      sizeBytes: doc.sizeBytes,
      createdAt: rawDoc.createdAt ? new Date(rawDoc.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: rawDoc.updatedAt ? new Date(rawDoc.updatedAt).toISOString() : new Date().toISOString(),
    };
  }
}
