import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Organization, OrganizationSchema } from '../organizations/infrastructure/organization.schema';
import { User, UserSchema } from '../users/infrastructure/user.schema';
import { UserSession, UserSessionSchema } from '../auth/infrastructure/user-session.schema';
import { EngagementType, EngagementTypeSchema } from '../organizations/infrastructure/engagement-type.schema';
import { Project, ProjectSchema } from '../projects/infrastructure/project.schema';
import { ConversionJob, ConversionJobSchema } from '../conversions/infrastructure/conversion-job.schema';
import { AuditLog, AuditLogSchema } from '../audit/infrastructure/audit-log.schema';
import { PlatformAdminService } from './application/platform-admin.service';
import { PlatformAdminController } from './presentation/platform-admin.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: EngagementType.name, schema: EngagementTypeSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ConversionJob.name, schema: ConversionJobSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
  exports: [PlatformAdminService],
})
export class AdminModule {}
