import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/infrastructure/organization.schema';
import { User, UserSchema } from '../users/infrastructure/user.schema';
import { UserSession, UserSessionSchema } from '../auth/infrastructure/user-session.schema';
import {
  EngagementType,
  EngagementTypeSchema,
} from '../organizations/infrastructure/engagement-type.schema';
import { Project, ProjectSchema } from '../projects/infrastructure/project.schema';
import {
  ConversionJob,
  ConversionJobSchema,
} from '../conversions/infrastructure/conversion-job.schema';
import { AuditLog, AuditLogSchema } from '../audit/infrastructure/audit-log.schema';
import { PasswordReset, PasswordResetSchema } from '../auth/infrastructure/password-reset.schema';
import { Role, RoleSchema } from '../rbac/infrastructure/schemas/role.schema';
import { UserRole, UserRoleSchema } from '../rbac/infrastructure/schemas/user-role.schema';
import { Invoice, InvoiceSchema } from '../billing/infrastructure/invoice.schema';
import { Payment, PaymentSchema } from '../billing/infrastructure/payment.schema';
import {
  ProviderCompanyProfile,
  ProviderCompanyProfileSchema,
} from './infrastructure/provider-company-profile.schema';
import { ProviderCompanyProfileService } from './application/provider-company-profile.service';
import { ProviderCompanyProfileController } from './presentation/provider-company-profile.controller';
import { EMAIL_PORT } from '../auth/domain/email.port';
import { SmtpEmailAdapter } from '../auth/infrastructure/smtp-email.adapter';
import { PlatformAdminService } from './application/platform-admin.service';
import { LockUserService } from './application/lock-user.service';
import { AuditLogService } from './application/audit-log.service';
import { PlatformAdminController } from './presentation/platform-admin.controller';
import { RbacModule } from '../rbac/rbac.module';
import { PlatformAdminAccessService } from './application/platform-admin-access.service';
import { PlatformAdminAuthorizationGuard } from './presentation/platform-admin-authorization.guard';

@Module({
  imports: [
    RbacModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: User.name, schema: UserSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: EngagementType.name, schema: EngagementTypeSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ConversionJob.name, schema: ConversionJobSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
      { name: Role.name, schema: RoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: ProviderCompanyProfile.name, schema: ProviderCompanyProfileSchema },
    ]),
  ],
  controllers: [PlatformAdminController, ProviderCompanyProfileController],
  providers: [
    PlatformAdminAccessService,
    PlatformAdminAuthorizationGuard,
    PlatformAdminService,
    LockUserService,
    AuditLogService,
    ProviderCompanyProfileService,
    { provide: EMAIL_PORT, useClass: SmtpEmailAdapter },
  ],
  exports: [
    PlatformAdminService,
    LockUserService,
    AuditLogService,
    PlatformAdminAccessService,
    PlatformAdminAuthorizationGuard,
    ProviderCompanyProfileService,
  ],
})
export class AdminModule {}
