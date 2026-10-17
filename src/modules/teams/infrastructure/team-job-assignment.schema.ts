import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongoSchema, Types } from 'mongoose';

@Schema({ collection: 'team_job_assignments', timestamps: true })
export class TeamJobAssignment {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) organizationId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) teamId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) projectId!: Types.ObjectId;
  @Prop({ type: MongoSchema.Types.ObjectId, required: true }) jobId!: Types.ObjectId;
  @Prop({ required: true }) memberId!: string;
  @Prop({ required: true }) assignedBy!: string;
  @Prop({ required: true, default: Date.now }) assignedAt!: Date;
  @Prop({ type: Date, default: null }) revokedAt!: Date | null;
  @Prop() revokedBy?: string;
}
export const TeamJobAssignmentSchema = SchemaFactory.createForClass(TeamJobAssignment);
TeamJobAssignmentSchema.index(
  { organizationId: 1, jobId: 1 },
  {
    unique: true,
    partialFilterExpression: { revokedAt: null },
    name: 'one_active_team_job_assignment',
  },
);
TeamJobAssignmentSchema.index({ organizationId: 1, teamId: 1, revokedAt: 1 });
