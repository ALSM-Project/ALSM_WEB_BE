import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/infrastructure/organization.schema';
import {
  OrganizationMembership,
  OrganizationMembershipSchema,
} from '../organizations/infrastructure/organization-membership.schema';
import { Partner, PartnerSchema } from '../partners/infrastructure/partner.schema';
import { Project, ProjectSchema } from '../projects/infrastructure/project.schema';
import { RbacModule } from '../rbac/rbac.module';
import { Team, TeamSchema } from '../teams/infrastructure/team.schema';
import { User, UserSchema } from '../users/infrastructure/user.schema';
import { WorkforceService } from './application/workforce.service';
import { WorkforceController } from './presentation/workforce.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrganizationMembership.name, schema: OrganizationMembershipSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
      { name: Team.name, schema: TeamSchema },
      { name: Partner.name, schema: PartnerSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
    RbacModule,
    AuditModule,
  ],
  controllers: [WorkforceController],
  providers: [WorkforceService],
  exports: [WorkforceService, MongooseModule],
})
export class WorkforceModule {}
