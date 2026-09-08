import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserPreferencesDocument = UserPreferences & Document;

@Schema({ collection: 'user_preferences', timestamps: true })
export class UserPreferences {
  @Prop({ required: true, unique: true })
  userId!: string;

  @Prop({ type: [String], default: [] })
  pinnedMenuItemIds!: string[];

  @Prop({ type: [String], default: [] })
  recentMenuItemIds!: string[];

  @Prop({ type: [String], default: [] })
  hiddenMenuItemIds!: string[];

  @Prop({ type: Map, of: Number, default: {} })
  menuItemUsageCount!: Map<string, number>;

  @Prop({ type: Map, of: Date, default: {} })
  menuItemLastUsed!: Map<string, Date>;

  @Prop({ type: Map, of: Number, default: {} })
  menuItemOrder!: Map<string, number>;

  @Prop({ default: false })
  isSidebarCollapsed!: boolean;

  @Prop({ default: 'auto', enum: ['auto', 'light', 'dark'] })
  themePreference!: 'auto' | 'light' | 'dark';
}

export const UserPreferencesSchema = SchemaFactory.createForClass(UserPreferences);
