import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConversionWorkloadPort } from '../domain/conversion-workload.port';
import { ConversionJob } from './conversion-job.schema';

@Injectable()
export class MongoConversionWorkloadReader implements ConversionWorkloadPort {
  constructor(@InjectModel(ConversionJob.name) private readonly jobs: Model<ConversionJob>) {}
  async listAssignedJobs(input: Parameters<ConversionWorkloadPort['listAssignedJobs']>[0]) {
    if (!input.jobIds.length) return [];
    const rows = await this.jobs
      .find({
        organizationId: new Types.ObjectId(input.organizationId),
        projectId: new Types.ObjectId(input.projectId),
        _id: { $in: input.jobIds.map((id) => new Types.ObjectId(id)) },
        createdAt: { $gte: input.start, $lt: input.end },
      })
      .select({ _id: 1, status: 1 })
      .lean()
      .exec();
    return rows.map((job) => ({ id: String(job._id), status: job.status }));
  }
}
