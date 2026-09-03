import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MenuAnalyticsDocument = MenuAnalytics & Document;

@Schema({ collection: 'menu_analytics', timestamps: true })
export class MenuAnalytics {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  menuItemId!: string;

  @Prop({ required: true, enum: ['click', 'hover', 'search'] })
  action!: 'click' | 'hover' | 'search';

  @Prop({ required: true })
  sessionId!: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  @Prop({ default: Date.now })
  timestamp!: Date;
}

export const MenuAnalyticsSchema = SchemaFactory.createForClass(MenuAnalytics);
