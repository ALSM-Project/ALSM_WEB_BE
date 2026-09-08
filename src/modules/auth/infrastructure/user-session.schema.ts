import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
export type UserSessionDocument = HydratedDocument<UserSession>;
@Schema({ collection: 'user_sessions', timestamps: true })
export class UserSession {
  @Prop({ required: true, unique: true, index: true }) tokenId!: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  userId!: Types.ObjectId;
  @Prop({ required: true, select: false }) refreshTokenHash!: string;
  @Prop({ required: true, index: { expires: 0 } }) expiresAt!: Date;
  @Prop() revokedAt?: Date;
}
export const UserSessionSchema = SchemaFactory.createForClass(UserSession);
