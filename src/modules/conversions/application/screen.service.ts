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
      if (job.screenId) {
        const raw = job.screenId.toString();
        completedIdentifiers.add(raw);
        const clean = raw.replace(/\.(bms|dspf|cob|cbl|cpy)$/i, '');
        completedIdentifiers.add(clean);
        completedIdentifiers.add(`${clean}.bms`);
        completedIdentifiers.add(`${clean}.dspf`);
        completedIdentifiers.add(`${clean}.cob`);
        completedIdentifiers.add(`${clean}.cbl`);
      }
      if (job.inputReference) completedIdentifiers.add(job.inputReference.toString());
    }

    return Promise.all(
      screens.map(async (doc) => {
        const dto = this.toResponseDto(doc);
        const docCleanName = doc.name ? doc.name.replace(/\.(bms|dspf|cob|cbl|cpy)$/i, '') : '';
        const isCompleted =
          completedIdentifiers.has(doc._id.toString()) ||
          completedIdentifiers.has(doc.name) ||
          completedIdentifiers.has(docCleanName) ||
          (doc.inputReference && completedIdentifiers.has(doc.inputReference));
        if (isCompleted && doc.status !== 'COMPLETED') {
          await this.screenModel.updateOne({ _id: doc._id }, { status: 'COMPLETED' }).exec();
          dto.status = 'COMPLETED';
        }
        return dto;
      }),
    );
  }

  async updateScreenStatus(screenId: string, status: ScreenStatus) {
    if (Types.ObjectId.isValid(screenId)) {
      await this.screenModel.updateOne({ _id: screenId }, { status }).exec();
    }
    const clean = screenId.replace(/\.(bms|dspf|cob|cbl|cpy)$/i, '');
    const nameRegex = new RegExp(`^${clean}(\\.(bms|dspf|cob|cbl|cpy))?$`, 'i');
    await this.screenModel
      .updateMany(
        {
          $or: [{ name: screenId }, { name: nameRegex }, { inputReference: screenId }],
        },
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
      const clean = screenId.replace(/\.(bms|dspf|cob|cbl|cpy)$/i, '');
      const nameRegex = new RegExp(`^${clean}(\\.(bms|dspf|cob|cbl|cpy))?$`, 'i');
      screen = await this.screenModel
        .findOne({
          $or: [{ name: screenId }, { name: nameRegex }, { inputReference: screenId }],
        })
        .exec();
    }
    if (!screen) {
      throw new NotFoundException({
        code: 'SCREEN_NOT_FOUND',
        message: `Screen with identifier ${screenId} was not found`,
      });
    }

    const docCleanName = screen.name ? screen.name.replace(/\.(bms|dspf|cob|cbl|cpy)$/i, '') : '';
    const completedJob = await this.conversionJobModel.findOne({
      status: 'COMPLETED',
      $or: [
        { screenId: screen._id.toString() },
        { screenId: screen.name },
        { screenId: docCleanName },
        { inputReference: screen.inputReference },
      ],
    }).exec();

    if (completedJob && screen.status !== 'COMPLETED') {
      await this.screenModel.updateOne({ _id: screen._id }, { status: 'COMPLETED' }).exec();
      screen.status = 'COMPLETED';
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
      // Purge all records with matching ID, matching file name, or matching inputReference
      await this.screenModel
        .deleteMany({
          $or: [{ _id: screen._id }, { name: screen.name }, { inputReference: screen.inputReference }],
        })
        .exec();
    } else {
      const deleteConditions: Record<string, any>[] = [{ name: screenId }, { inputReference: screenId }];
      if (Types.ObjectId.isValid(screenId)) {
        deleteConditions.push({ _id: screenId });
      }
      await this.screenModel.deleteMany({ $or: deleteConditions }).exec();
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
