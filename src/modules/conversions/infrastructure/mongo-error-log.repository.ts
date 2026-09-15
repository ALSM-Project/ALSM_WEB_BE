import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { ErrorLog, ErrorLogDocument } from './error-log.schema';
import {
  ErrorLogRecord,
  ErrorLogRepository,
  ErrorLogListQuery,
  ErrorLogStatus,
  ErrorLogSummary,
  PaginatedErrorLogs,
} from '../domain/error-log.types';

@Injectable()
export class MongoErrorLogRepository implements ErrorLogRepository {
  constructor(@InjectModel(ErrorLog.name) private readonly model: Model<ErrorLog>) {}

  async create(input: Omit<ErrorLogRecord, 'id' | 'createdAt'>): Promise<ErrorLogRecord> {
    const doc = await this.model.create({
      ...input,
      organizationId: new Types.ObjectId(input.organizationId),
      projectId: new Types.ObjectId(input.projectId),
      resolvedBy: input.resolvedBy ? new Types.ObjectId(input.resolvedBy) : undefined,
    });
    return this.map(doc);
  }

  async findById(id: string, projectId: string, organizationId: string): Promise<ErrorLogRecord | null> {
    const doc = await this.model.findOne({ _id: id, projectId, organizationId }).exec();
    return doc ? this.map(doc) : null;
  }

  async list(projectId: string, organizationId: string, query: ErrorLogListQuery): Promise<PaginatedErrorLogs> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: FilterQuery<ErrorLog> = { projectId, organizationId };
    if (query.severity) filter.severity = query.severity;
    if (query.status) filter.status = query.status;
    if (query.search) {
      filter.$or = [
        { screenName: { $regex: query.search, $options: 'i' } },
        { errorCode: { $regex: query.search, $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((d) => this.map(d)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async resolve(id: string, projectId: string, organizationId: string, userId: string): Promise<ErrorLogRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, projectId, organizationId, status: { $ne: ErrorLogStatus.RESOLVED } },
        {
          $set: {
            status: ErrorLogStatus.RESOLVED,
            resolvedAt: new Date(),
            resolvedBy: new Types.ObjectId(userId),
          },
        },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async ignore(id: string, projectId: string, organizationId: string): Promise<ErrorLogRecord | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, projectId, organizationId, status: ErrorLogStatus.UNRESOLVED },
        { $set: { status: ErrorLogStatus.IGNORED } },
        { new: true },
      )
      .exec();
    return doc ? this.map(doc) : null;
  }

  async getSummary(projectId: string, organizationId: string): Promise<ErrorLogSummary> {
    const results = await this.model
      .aggregate<{ severity: string; status: string; count: number }>([
        { $match: { projectId, organizationId } },
        { $group: { _id: { severity: '$severity', status: '$status' }, count: { $sum: 1 } } },
        { $project: { severity: '$_id.severity', status: '$_id.status', count: 1, _id: 0 } },
      ])
      .exec();

    const summary: ErrorLogSummary = { total: 0, fatal: 0, error: 0, warning: 0, resolved: 0, unresolved: 0, ignored: 0 };

    for (const r of results) {
      summary.total += r.count;
      if (r.severity === 'FATAL') summary.fatal += r.count;
      if (r.severity === 'ERROR') summary.error += r.count;
      if (r.severity === 'WARNING') summary.warning += r.count;
      if (r.status === 'RESOLVED') summary.resolved += r.count;
      if (r.status === 'UNRESOLVED') summary.unresolved += r.count;
      if (r.status === 'IGNORED') summary.ignored += r.count;
    }

    return summary;
  }

  private map(doc: ErrorLogDocument): ErrorLogRecord {
    return {
      id: doc.id as string,
      organizationId: doc.organizationId.toString(),
      projectId: doc.projectId.toString(),
      screenName: doc.screenName,
      errorCode: doc.errorCode,
      severity: doc.severity,
      status: doc.status,
      lineNumber: doc.lineNumber,
      offendingCode: doc.offendingCode,
      suggestedPatch: {
        offendingLine: doc.suggestedPatch.offendingLine,
        suggestedLine: doc.suggestedPatch.suggestedLine,
        reason: doc.suggestedPatch.reason,
      },
      resolvedBy: doc.resolvedBy?.toString(),
      resolvedAt: doc.resolvedAt,
      createdAt: doc.createdAt,
    };
  }
}
