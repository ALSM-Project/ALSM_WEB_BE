import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SystemNotification } from './notification.schema';
import { User } from '../users/infrastructure/user.schema';

export interface CreateNotificationInput {
  recipientUserIds: string[];
  type: string;
  title: string;
  message: string;
  eventKey: string;
  resourceType?: string;
  resourceId?: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(SystemNotification.name) private readonly model: Model<SystemNotification>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async createForEmails(input: Omit<CreateNotificationInput, 'recipientUserIds'> & { recipientEmails: string[] }): Promise<number> {
    const emails = [...new Set(input.recipientEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return 0;
    const recipients = await this.users.find({
      email: { $in: emails },
      isLocked: { $ne: true },
      $or: [{ isActive: true }, { isActive: { $exists: false } }],
    }).select('_id').lean().exec();
    return this.createForUsers({
      ...input,
      recipientUserIds: recipients.map((user) => String(user._id)),
    });
  }

  async createForUsers(input: CreateNotificationInput): Promise<number> {
    const recipients = [...new Set(input.recipientUserIds.filter((id) => Types.ObjectId.isValid(id)))];
    if (!recipients.length) return 0;
    await this.model.bulkWrite(recipients.map((userId) => ({
      updateOne: {
        filter: { eventKey: `${input.eventKey}:${userId}` },
        update: {
          $setOnInsert: {
            userId: new Types.ObjectId(userId),
            type: input.type,
            title: input.title,
            message: input.message,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            link: input.link,
            eventKey: `${input.eventKey}:${userId}`,
            isRead: false,
          },
        },
        upsert: true,
      },
    })), { ordered: false });
    return recipients.length;
  }

  async listForUser(userId: string) {
    const userObjectId = new Types.ObjectId(userId);
    const [items, unreadCount] = await Promise.all([
      this.model.find({ userId: userObjectId }).sort({ createdAt: -1 }).limit(50).lean().exec(),
      this.model.countDocuments({ userId: userObjectId, isRead: false }).exec(),
    ]);
    return {
      items: items.map((item) => ({
        id: String(item._id),
        type: item.type,
        title: item.title,
        message: item.message,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        link: item.link,
        isRead: item.isRead,
        createdAt: item.createdAt,
      })),
      unreadCount,
    };
  }

  async markRead(userId: string, notificationId: string) {
    if (!Types.ObjectId.isValid(notificationId)) throw new NotFoundException('Notification not found.');
    const updated = await this.model.findOneAndUpdate(
      { _id: new Types.ObjectId(notificationId), userId: new Types.ObjectId(userId) },
      { $set: { isRead: true } },
      { new: true },
    ).lean().exec();
    if (!updated) throw new NotFoundException('Notification not found.');
    return { id: String(updated._id), isRead: updated.isRead };
  }

  async markAllRead(userId: string) {
    const result = await this.model.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    ).exec();
    return { updatedCount: result.modifiedCount };
  }
}
