import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FEEDBACK_CATEGORIES,
  FeedbackStatus,
  SupportFeedback,
  SupportFeedbackDocument,
} from '../infrastructure/support-feedback.schema';
import {
  CreateFeedbackDto,
  FeedbackSummaryResult,
  SupportFeedbackItem,
  UpdateFeedbackStatusDto,
} from '../presentation/support-feedback.dto';

@Injectable()
export class SupportFeedbackService {
  constructor(
    @InjectModel(SupportFeedback.name)
    private readonly feedbackModel: Model<SupportFeedbackDocument>,
  ) {}

  private mapDoc(doc: any): SupportFeedbackItem {
    return {
      id: doc._id.toString(),
      userId: doc.userId?.toString() || '',
      userEmail: doc.userEmail,
      userName: doc.userName,
      organizationId: doc.organizationId?.toString(),
      rating: doc.rating,
      category: doc.category,
      description: doc.description,
      attachments: doc.attachments || [],
      status: doc.status,
      staffNotes: doc.staffNotes,
      reviewedByName: doc.reviewedByName,
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async submitFeedback(
    user: { userId: string; email: string; fullName?: string; organizationId?: string },
    dto: CreateFeedbackDto,
  ): Promise<SupportFeedbackItem> {
    const created = await this.feedbackModel.create({
      userId: Types.ObjectId.isValid(user.userId) ? new Types.ObjectId(user.userId) : new Types.ObjectId(),
      userEmail: user.email.toLowerCase().trim(),
      userName: user.fullName || user.email.split('@')[0] || 'User',
      organizationId:
        user.organizationId && Types.ObjectId.isValid(user.organizationId)
          ? new Types.ObjectId(user.organizationId)
          : undefined,
      rating: dto.rating,
      category: dto.category,
      description: dto.description.trim(),
      attachments: dto.attachments || [],
      status: FeedbackStatus.SUBMITTED,
    });

    return this.mapDoc(created.toObject());
  }

  async listMyFeedback(user: { userId: string; email: string }): Promise<SupportFeedbackItem[]> {
    const orFilter: any[] = [{ userEmail: user.email.toLowerCase().trim() }];
    if (Types.ObjectId.isValid(user.userId)) {
      orFilter.push({ userId: new Types.ObjectId(user.userId) });
    }

    const docs = await this.feedbackModel
      .find({ $or: orFilter })
      .sort({ createdAt: -1 })
      .lean();

    return docs.map((d) => this.mapDoc(d));
  }

  async listAllFeedback(query: {
    category?: string;
    status?: string;
    rating?: string;
    search?: string;
  }): Promise<SupportFeedbackItem[]> {
    const filter: Record<string, any> = {};

    if (query.category && query.category !== 'ALL') {
      filter.category = query.category;
    }
    if (query.status && query.status !== 'ALL') {
      filter.status = query.status;
    }
    if (query.rating && query.rating !== 'ALL') {
      const parsed = Number(query.rating);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
        filter.rating = parsed;
      }
    }
    if (query.search && query.search.trim()) {
      const regex = new RegExp(query.search.trim(), 'i');
      filter.$or = [
        { userName: regex },
        { userEmail: regex },
        { description: regex },
        { category: regex },
      ];
    }

    const docs = await this.feedbackModel.find(filter).sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.mapDoc(d));
  }

  async updateFeedbackStatus(
    id: string,
    reviewer: { userId: string; email: string; fullName?: string },
    dto: UpdateFeedbackStatusDto,
  ): Promise<SupportFeedbackItem> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(`Invalid feedback ID: ${id}`);
    }

    const update: Record<string, any> = {
      status: dto.status,
      reviewedByName: reviewer.fullName || reviewer.email,
      reviewedAt: new Date(),
    };
    if (Types.ObjectId.isValid(reviewer.userId)) {
      update.reviewedByUserId = new Types.ObjectId(reviewer.userId);
    }
    if (dto.staffNotes !== undefined) {
      update.staffNotes = dto.staffNotes.trim();
    }

    const updated = await this.feedbackModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .lean();

    if (!updated) {
      throw new NotFoundException(`Feedback ${id} not found`);
    }

    return this.mapDoc(updated);
  }

  async getSummary(): Promise<FeedbackSummaryResult> {
    const docs = await this.feedbackModel.find().lean();
    const totalCount = docs.length;
    const sumRating = docs.reduce((acc, d) => acc + (d.rating || 0), 0);
    const averageRating = totalCount > 0 ? Number((sumRating / totalCount).toFixed(2)) : 0;

    const ratingDistribution = [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: docs.filter((d) => d.rating === rating).length,
    }));

    const categoryBreakdown = FEEDBACK_CATEGORIES.map((category) => {
      const items = docs.filter((d) => d.category === category);
      const avg =
        items.length > 0
          ? Number((items.reduce((acc, d) => acc + d.rating, 0) / items.length).toFixed(2))
          : 0;
      return { category, count: items.length, averageRating: avg };
    });

    const statusBreakdown = Object.values(FeedbackStatus).map((status) => ({
      status,
      count: docs.filter((d) => d.status === status).length,
    }));

    return {
      totalCount,
      averageRating,
      ratingDistribution,
      categoryBreakdown,
      statusBreakdown,
    };
  }
}
