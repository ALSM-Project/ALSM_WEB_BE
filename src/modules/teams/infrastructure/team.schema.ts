import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';
import { TeamKind, TeamProjectAssignment } from '../domain/team.types';

@Schema({ collection: 'teams', timestamps: true })
export class Team {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) organizationId!: Types.ObjectId;
  @Prop({ required: true, maxlength: 120 }) name!: string;
  @Prop({ enum: TeamKind, required: true }) kind!: TeamKind;
  @Prop({ type: [String], default: [] }) memberIds!: string[];
  @Prop({ type: [String], default: [] }) managerIds!: string[];
  @Prop({ type: [Object], default: [] }) projectAssignments!: TeamProjectAssignment[];
  @Prop({ required: true, default: 1 }) revision!: number;
  // Atomically retained attribution for every membership/assignment change, even if
  // the separate central audit append is unavailable. Not used as KPI history.
  @Prop({ type: [Object], default: [] }) changes!: Record<string, unknown>[];
}
export const TeamSchema = SchemaFactory.createForClass(Team);
TeamSchema.index({ organizationId: 1, kind: 1, managerIds: 1 });
