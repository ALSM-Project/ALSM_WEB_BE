import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
export type UserDocument = HydratedDocument<User>;
@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true }) email!: string;
  @Prop({ required: true, select: false }) passwordHash!: string;
  @Prop({ required: true, trim: true }) fullName!: string;
  @Prop({ default: false }) isPlatformAdmin!: boolean;
  @Prop({ default: true }) isActive!: boolean;
  @Prop({
    type: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, default: null, select: false },
      setupFailureCount: { type: Number, default: 0 },
      backupCodeHashes: { type: [String], default: [], select: false },
    },
    default: () => ({
      enabled: false,
      secret: null,
      setupFailureCount: 0,
      backupCodeHashes: [],
    }),
  })
  mfa!: {
    enabled: boolean;
    secret: string | null;
    setupFailureCount: number;
    backupCodeHashes: string[];
  };
  createdAt!: Date;
  updatedAt!: Date;
}
export const UserSchema = SchemaFactory.createForClass(User);
