import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ScreenSourceType = 'BMS' | 'DSPF' | 'COBOL';
export type ScreenStatus = 'READY' | 'PROCESSING' | 'COMPLETED' | 'REVIEW_REQUIRED' | 'FAILED';

@Schema({ timestamps: true, collection: 'screens' })
export class ScreenDocument extends Document {
  @Prop({ required: true })
  projectId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ['BMS', 'DSPF', 'COBOL'], default: 'BMS' })
  sourceType!: ScreenSourceType;

  @Prop({
    required: true,
    enum: ['READY', 'PROCESSING', 'COMPLETED', 'REVIEW_REQUIRED', 'FAILED'],
    default: 'READY',
  })
  status!: ScreenStatus;

  @Prop({ required: true })
  inputReference!: string;

  @Prop({ type: Number })
  sizeBytes?: number;

  @Prop()
  content?: string;
}

export const ScreenSchema = SchemaFactory.createForClass(ScreenDocument);
