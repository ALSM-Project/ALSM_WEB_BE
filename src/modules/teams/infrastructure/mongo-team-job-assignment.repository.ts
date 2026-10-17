import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { HydratedDocument, Model, Types } from 'mongoose';
import {
  TeamJobAssignmentRecord,
  TeamJobAssignmentRepository,
} from '../domain/team-job-assignment.types';
import { TeamJobAssignment } from './team-job-assignment.schema';

@Injectable()
export class MongoTeamJobAssignmentRepository implements TeamJobAssignmentRepository {
  constructor(
    @InjectModel(TeamJobAssignment.name) private readonly model: Model<TeamJobAssignment>,
  ) {}
  async listActive(organizationId: string, teamId: string) {
    const rows = await this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        teamId: new Types.ObjectId(teamId),
        revokedAt: null,
      })
      .exec();
    return rows.map((row) => this.map(row));
  }
  async assign(input: Parameters<TeamJobAssignmentRepository['assign']>[0]) {
    await this.model.init();
    const indexes = await this.model.collection.indexes();
    const unique = indexes.find((index) => index.name === 'one_active_team_job_assignment');
    if (
      !unique?.unique ||
      JSON.stringify(unique.key) !== JSON.stringify({ organizationId: 1, jobId: 1 }) ||
      JSON.stringify(unique.partialFilterExpression) !== JSON.stringify({ revokedAt: null })
    ) {
      throw new ServiceUnavailableException({
        code: 'TEAM_ASSIGNMENT_INDEX_UNAVAILABLE',
        message:
          'The scoped active-assignment uniqueness index must be provisioned before assignment',
      });
    }
    try {
      return this.map(
        await this.model.create({
          ...input,
          organizationId: new Types.ObjectId(input.organizationId),
          teamId: new Types.ObjectId(input.teamId),
          projectId: new Types.ObjectId(input.projectId),
          jobId: new Types.ObjectId(input.jobId),
        }),
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)
        return null;
      throw error;
    }
  }
  async revoke(organizationId: string, teamId: string, jobId: string, actorUserId: string) {
    const result = await this.model
      .updateOne(
        {
          organizationId: new Types.ObjectId(organizationId),
          teamId: new Types.ObjectId(teamId),
          jobId: new Types.ObjectId(jobId),
          revokedAt: null,
        },
        { $set: { revokedAt: new Date(), revokedBy: actorUserId } },
      )
      .exec();
    return result.modifiedCount === 1;
  }
  private map(row: HydratedDocument<TeamJobAssignment>): TeamJobAssignmentRecord {
    return {
      id: String(row._id),
      organizationId: String(row.organizationId),
      teamId: String(row.teamId),
      projectId: String(row.projectId),
      jobId: String(row.jobId),
      memberId: row.memberId,
      assignedBy: row.assignedBy,
      assignedAt: row.assignedAt,
    };
  }
}
