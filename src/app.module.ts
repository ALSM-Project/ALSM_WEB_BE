import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { environmentValidationSchema } from './config/environment.validation';
import { RequestIdMiddleware } from './shared/logging/request-id.middleware';
import { JwtAuthGuard } from './shared/security/jwt-auth.guard';
import { PermissionsGuard } from './shared/security/permissions.guard';
import { User, UserSchema } from './modules/users/infrastructure/user.schema';
import {
  Organization,
  OrganizationSchema,
} from './modules/organizations/infrastructure/organization.schema';
import { UserSession, UserSessionSchema } from './modules/auth/infrastructure/user-session.schema';
import {
  PasswordReset,
  PasswordResetSchema,
} from './modules/auth/infrastructure/password-reset.schema';
import {
  EmailVerification,
  EmailVerificationSchema,
} from './modules/auth/infrastructure/email-verification.schema';
import { AuditLog, AuditLogSchema } from './modules/audit/infrastructure/audit-log.schema';
import { Project, ProjectSchema } from './modules/projects/infrastructure/project.schema';
import {
  ConversionJob,
  ConversionJobSchema,
} from './modules/conversions/infrastructure/conversion-job.schema';
import {
  FieldMapping,
  FieldMappingSchema,
} from './modules/conversions/infrastructure/field-mapping.schema';
import { USER_REPOSITORY } from './modules/users/domain/user.repository';
import { MongoUserRepository } from './modules/users/infrastructure/mongo-user.repository';
import { ORGANIZATION_REPOSITORY } from './modules/organizations/domain/organization.repository';
import { MongoOrganizationRepository } from './modules/organizations/infrastructure/mongo-organization.repository';
import { SESSION_REPOSITORY } from './modules/auth/domain/session.repository';
import { MongoSessionRepository } from './modules/auth/infrastructure/mongo-session.repository';
import { AUDIT_REPOSITORY } from './modules/audit/domain/audit.repository';
import { MongoAuditRepository } from './modules/audit/infrastructure/mongo-audit.repository';
import { PROJECT_REPOSITORY } from './modules/projects/domain/project.types';
import { MongoProjectRepository } from './modules/projects/infrastructure/mongo-project.repository';
import {
  CONVERSION_ENGINE,
  CONVERSION_JOB_REPOSITORY,
  CONVERSION_QUEUE,
} from './modules/conversions/domain/conversion-job.types';
import { MongoConversionJobRepository } from './modules/conversions/infrastructure/mongo-conversion-job.repository';
import { BullMqConversionQueue } from './modules/conversions/infrastructure/bullmq-conversion.queue';
import { UnconfiguredConversionEngineAdapter } from './modules/conversions/infrastructure/unconfigured-conversion-engine.adapter';
import { FIELD_MAPPING_REPOSITORY } from './modules/conversions/domain/field-mapping.types';
import { MongoFieldMappingRepository } from './modules/conversions/infrastructure/mongo-field-mapping.repository';
import { GetFieldMappingService } from './modules/conversions/application/get-field-mapping.service';
import { SaveFieldMappingService } from './modules/conversions/application/save-field-mapping.service';
import { FieldMappingController } from './modules/conversions/presentation/field-mapping.controller';
import { AuthService } from './modules/auth/application/auth.service';
import { ConfirmMfaSetupService } from './modules/auth/application/confirm-mfa-setup.service';
import { MFA_SECURITY } from './modules/auth/application/mfa-security.port';
import { StartMfaSetupService } from './modules/auth/application/start-mfa-setup.service';
import { MfaSecurityService } from './modules/auth/infrastructure/mfa-security.service';
import { ForgotPasswordService } from './modules/auth/application/forgot-password.service';
import { ResetPasswordService } from './modules/auth/application/reset-password.service';
import { ChangePasswordService } from './modules/auth/application/change-password.service';
import { SetPasswordService } from './modules/auth/application/set-password.service';
import { EMAIL_PORT } from './modules/auth/domain/email.port';

import { SmtpEmailAdapter } from './modules/auth/infrastructure/smtp-email.adapter';
import { PASSWORD_RESET_REPOSITORY } from './modules/auth/domain/password-reset.repository';
import { MongoPasswordResetRepository } from './modules/auth/infrastructure/mongo-password-reset.repository';
import { EMAIL_VERIFICATION_REPOSITORY } from './modules/auth/domain/email-verification.repository';
import { MongoEmailVerificationRepository } from './modules/auth/infrastructure/mongo-email-verification.repository';
import { EmailVerificationService } from './modules/auth/application/email-verification.service';
import { AuthController } from './modules/auth/presentation/auth.controller';
import { OrganizationAuthorizationService } from './modules/organizations/application/organization-authorization.service';
import { OrganizationContextService } from './modules/organizations/application/organization-context.service';
import { ProjectService } from './modules/projects/application/project.service';
import { ProjectsController } from './modules/projects/presentation/projects.controller';
import { ConversionJobService } from './modules/conversions/application/conversion-job.service';
import { ConversionsController } from './modules/conversions/presentation/conversions.controller';
import { HealthController } from './modules/health/health.controller';
import { ConversionWorkerRunner } from './modules/conversions/infrastructure/conversion-worker.runner';
import { ExportCodeService } from './modules/conversions/application/export-code.service';
import { ExportController } from './modules/conversions/presentation/export.controller';
import { Subscription, SubscriptionSchema } from './modules/billing/infrastructure/subscription.schema';
import { Invoice, InvoiceSchema } from './modules/billing/infrastructure/invoice.schema';
import { Payment, PaymentSchema } from './modules/billing/infrastructure/payment.schema';
import { Plan, PlanSchema } from './modules/billing/infrastructure/plan.schema';
import { BankConfig, BankConfigSchema } from './modules/billing/infrastructure/bank-config.schema';
import { BillingService } from './modules/billing/application/billing.service';
import { PaymentService } from './modules/billing/application/payment.service';
import { UsageService } from './modules/billing/application/usage.service';
import { BillingController } from './modules/billing/presentation/billing.controller';
import { PaymentController } from './modules/billing/presentation/payment.controller';
import {
  BANK_CONFIG_REPOSITORY,
  BILLING_USAGE_REPOSITORY,
  INVOICE_REPOSITORY,
  PAYMENT_REPOSITORY,
  PLAN_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from './modules/billing/domain/billing.repository.interface';
import { MongoSubscriptionRepository } from './modules/billing/infrastructure/persistence/mongo-subscription.repository';
import { MongoInvoiceRepository } from './modules/billing/infrastructure/persistence/mongo-invoice.repository';
import { MongoPaymentRepository } from './modules/billing/infrastructure/persistence/mongo-payment.repository';
import { MongoPlanRepository } from './modules/billing/infrastructure/persistence/mongo-plan.repository';
import { MongoBankConfigRepository } from './modules/billing/infrastructure/persistence/mongo-bank-config.repository';
import { MongoBillingUsageRepository } from './modules/billing/infrastructure/persistence/mongo-billing-usage.repository';

import { RbacModule } from './modules/rbac/rbac.module';
import { MenuModule } from './modules/menus/menu.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: environmentValidationSchema }),
    JwtModule.register({ global: true }),
    MongooseModule.forRootAsync({ useFactory: () => ({ uri: process.env.MONGODB_URI }) }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ConversionJob.name, schema: ConversionJobSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: BankConfig.name, schema: BankConfigSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
      { name: EmailVerification.name, schema: EmailVerificationSchema },
      { name: FieldMapping.name, schema: FieldMappingSchema },
    ]),
    RbacModule,
    MenuModule,
  ],
  controllers: [
    AuthController,
    ProjectsController,
    ConversionsController,
    FieldMappingController,
    ExportController,
    HealthController,
    BillingController,
    PaymentController,
  ],
  providers: [
    JwtAuthGuard,
    PermissionsGuard,
    AuthService,
    StartMfaSetupService,
    ConfirmMfaSetupService,
    MfaSecurityService,
    ForgotPasswordService,
    ResetPasswordService,
    ChangePasswordService,
    SetPasswordService,
    EmailVerificationService,
    SmtpEmailAdapter,

    OrganizationContextService,
    OrganizationAuthorizationService,
    ProjectService,
    ConversionJobService,
    GetFieldMappingService,
    SaveFieldMappingService,
    ExportCodeService,
    ConversionWorkerRunner,
    BillingService,
    PaymentService,
    UsageService,
    MongoSubscriptionRepository,
    MongoInvoiceRepository,
    MongoPaymentRepository,
    MongoPlanRepository,
    MongoBankConfigRepository,
    { provide: MFA_SECURITY, useExisting: MfaSecurityService },
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    { provide: ORGANIZATION_REPOSITORY, useClass: MongoOrganizationRepository },
    { provide: SESSION_REPOSITORY, useClass: MongoSessionRepository },
    { provide: AUDIT_REPOSITORY, useClass: MongoAuditRepository },
    { provide: PROJECT_REPOSITORY, useClass: MongoProjectRepository },
    { provide: CONVERSION_JOB_REPOSITORY, useClass: MongoConversionJobRepository },
    { provide: SUBSCRIPTION_REPOSITORY, useClass: MongoSubscriptionRepository },
    { provide: INVOICE_REPOSITORY, useClass: MongoInvoiceRepository },
    { provide: PAYMENT_REPOSITORY, useClass: MongoPaymentRepository },
    { provide: PLAN_REPOSITORY, useClass: MongoPlanRepository },
    { provide: BANK_CONFIG_REPOSITORY, useClass: MongoBankConfigRepository },
    { provide: FIELD_MAPPING_REPOSITORY, useClass: MongoFieldMappingRepository },
    { provide: CONVERSION_QUEUE, useClass: BullMqConversionQueue },
    { provide: CONVERSION_ENGINE, useClass: UnconfiguredConversionEngineAdapter },
    { provide: EMAIL_PORT, useClass: SmtpEmailAdapter },
    { provide: BILLING_USAGE_REPOSITORY, useClass: MongoBillingUsageRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: MongoPasswordResetRepository },
    { provide: EMAIL_VERIFICATION_REPOSITORY, useClass: MongoEmailVerificationRepository },
  ],
  exports: [ConversionWorkerRunner],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
