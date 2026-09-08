import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IUserPreferencesRepository,
  UserPreferencesProps,
} from '../../domain/interfaces/menu.repository.interface';
import { MenuMapper } from '../mapper/menu.mapper';
import {
  UserPreferences,
  UserPreferencesDocument,
} from '../schemas/user-preferences.schema';

@Injectable()
export class MongoUserPreferencesRepository implements IUserPreferencesRepository {
  constructor(
    @InjectModel(UserPreferences.name)
    private readonly prefsModel: Model<UserPreferencesDocument>,
  ) {}

  async findByUserId(userId: string): Promise<UserPreferencesProps | null> {
    const doc = await this.prefsModel.findOne({ userId }).exec();
    return MenuMapper.userPreferencesToDomain(doc);
  }

  async save(
    userId: string,
    preferences: Partial<UserPreferencesProps>,
  ): Promise<UserPreferencesProps> {
    const updateData: Record<string, unknown> = { ...preferences };

    if (preferences.menuItemUsageCount) {
      updateData.menuItemUsageCount = new Map(Object.entries(preferences.menuItemUsageCount));
    }
    if (preferences.menuItemLastUsed) {
      updateData.menuItemLastUsed = new Map(Object.entries(preferences.menuItemLastUsed));
    }
    if (preferences.menuItemOrder) {
      updateData.menuItemOrder = new Map(Object.entries(preferences.menuItemOrder));
    }

    const doc = await this.prefsModel
      .findOneAndUpdate({ userId }, { $set: updateData }, { upsert: true, new: true })
      .exec();

    return MenuMapper.userPreferencesToDomain(doc)!;
  }
}
