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
import {
  MethodMapping,
  MethodMappingSchema,
} from './modules/conversions/infrastructure/method-mapping.schema';
import { Partner, PartnerSchema } from './modules/partners/infrastructure/partner.schema';
import { ErrorLog, ErrorLogSchema } from './modules/conversions/infrastructure/error-log.schema';
import {
  ValidationRun,
  ValidationRunSchema,
} from './modules/validation/infrastructure/validation-run.schema';
import {
  ValidationFinding,
  ValidationFindingSchema,
} from './modules/validation/infrastructure/validation-finding.schema';
import {
  ScreenDocument,
  ScreenSchema as ConversionScreenSchema,
} from './modules/conversions/infrastructure/screen.schema';
import { ScreenService as ConversionScreenService } from './modules/conversions/application/screen.service';
import { ScreensController as ConversionScreensController } from './modules/conversions/presentation/screens.controller';
import { Screen, ScreenSchema } from './modules/screens/infrastructure/screen.schema';
import { MongoScreenRepository } from './modules/screens/infrastructure/mongo-screen.repository';
import { ScreenService } from './modules/screens/application/screen.service';
import { ScreensController } from './modules/screens/presentation/screens.controller';
import { SCREEN_REPOSITORY } from './modules/screens/domain/screen.types';
import { MongoErrorLogRepository } from './modules/conversions/infrastructure/mongo-error-log.repository';
import { ErrorLogService } from './modules/conversions/application/error-log.service';
import { ErrorLogController } from './modules/conversions/presentation/error-log.controller';
import { ValidationController } from './modules/validation/presentation/validation.controller';
import { ERROR_LOG_REPOSITORY } from './modules/conversions/domain/error-log.types';
import { VALIDATION_RUN_REPOSITORY } from './modules/validation/domain/validation-run.repository';
import { VALIDATION_FINDING_REPOSITORY } from './modules/validation/domain/validation-finding.repository';
import { MongoValidationRunRepository } from './modules/validation/infrastructure/mongo-validation-run.repository';
import { MongoValidationFindingRepository } from './modules/validation/infrastructure/mongo-validation-finding.repository';
import { BuildValidationContextService } from './modules/validation/application/build-validation-context.service';
import { ValidationReadService } from './modules/validation/application/validation-read.service';
import { ExecuteAiValidationService } from './modules/validation/application/execute-ai-validation.service';
import { PrepareAiValidationContextService } from './modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from './modules/validation/application/validation-secret-redactor.service';
import { FakeAiValidatorAdapter } from './modules/validation/infrastructure/fake-ai-validator.adapter';
import { OpenAiValidatorAdapter } from './modules/validation/infrastructure/openai-ai-validator.adapter';
import { aiValidatorProvider } from './modules/validation/infrastructure/ai-validator.provider';
import { AiValidationRuntimeGuard } from './modules/validation/application/ai-validation-runtime.guard';
import { TriggerAiValidationService } from './modules/validation/application/trigger-ai-validation.service';
import { ReconcileValidationRunService } from './modules/validation/application/reconcile-validation-run.service';
import { ReviewValidationFindingService } from './modules/validation/application/review-validation-finding.service';
import { VALIDATION_QUEUE } from './modules/validation/domain/validation-queue.port';
import { BullMqValidationQueue } from './modules/validation/infrastructure/bullmq-validation.queue';
import { ValidationWorkerRunner } from './modules/validation/infrastructure/validation-worker.runner';
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
import { STORAGE_PORT } from './shared/storage/storage.port';
import { LocalDiskStorageAdapter } from './shared/storage/local-disk-storage.adapter';
import { BmsDspfConversionAdapter } from './modules/conversions/infrastructure/bms-dspf-conversion.adapter';
import { CobolJavaConversionAdapter } from './modules/conversions/infrastructure/cobol-java-conversion.adapter';
import { ConversionEngineRouter } from './modules/conversions/infrastructure/conversion-engine.router';
import { UploadConversionSourceService } from './modules/conversions/application/upload-conversion-source.service';
import { ConversionSourceController } from './modules/conversions/presentation/conversion-source.controller';
import { GetConversionResultService } from './modules/conversions/application/get-conversion-result.service';
import { FIELD_MAPPING_REPOSITORY } from './modules/conversions/domain/field-mapping.types';
import { MongoFieldMappingRepository } from './modules/conversions/infrastructure/mongo-field-mapping.repository';
import { GetFieldMappingService } from './modules/conversions/application/get-field-mapping.service';
import { SaveFieldMappingService } from './modules/conversions/application/save-field-mapping.service';
import { FieldMappingController } from './modules/conversions/presentation/field-mapping.controller';
import { METHOD_MAPPING_REPOSITORY } from './modules/conversions/domain/method-mapping.types';
import { MongoMethodMappingRepository } from './modules/conversions/infrastructure/mongo-method-mapping.repository';
import { GetMethodMappingService } from './modules/conversions/application/get-method-mapping.service';
import { SaveMethodMappingService } from './modules/conversions/application/save-method-mapping.service';
import { MethodMappingController } from './modules/conversions/presentation/method-mapping.controller';
import { PARTNER_REPOSITORY } from './modules/partners/domain/partner.types';
import { MongoPartnerRepository } from './modules/partners/infrastructure/mongo-partner.repository';
import { CreatePartnerService } from './modules/partners/application/create-partner.service';
import { ListPartnersService } from './modules/partners/application/list-partners.service';
import { PartnerController } from './modules/partners/presentation/partner.controller';
import { AuthService } from './modules/auth/application/auth.service';
import { ListActiveSessionsService } from './modules/auth/application/list-active-sessions.service';
import { RevokeSessionService } from './modules/auth/application/revoke-session.service';
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
import {
  Subscription,
  SubscriptionSchema,
} from './modules/billing/infrastructure/subscription.schema';
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

import { VALIDATION_REPOSITORY } from './modules/conversions/domain/validation.types';
import { MongoValidationRepository } from './modules/conversions/infrastructure/mongo-validation.repository';
import { RuleValidatorService } from './modules/conversions/application/rule-validator.service';
import { ValidationController as RuleValidationController } from './modules/conversions/presentation/validation.controller';

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
      { name: MethodMapping.name, schema: MethodMappingSchema },
      { name: Partner.name, schema: PartnerSchema },
      { name: ErrorLog.name, schema: ErrorLogSchema },
      { name: ScreenDocument.name, schema: ConversionScreenSchema },
      { name: Screen.name, schema: ScreenSchema },
      { name: ValidationRun.name, schema: ValidationRunSchema },
      { name: ValidationFinding.name, schema: ValidationFindingSchema },
    ]),
    RbacModule,
    MenuModule,
  ],
  controllers: [
    AuthController,
    ProjectsController,
    ConversionsController,
    ConversionSourceController,
    ScreensController,
    ConversionScreensController,
    FieldMappingController,
    MethodMappingController,
    PartnerController,
    ExportController,
    ErrorLogController,
    ValidationController,
    RuleValidationController,
    HealthController,
    BillingController,
    PaymentController,
  ],
  providers: [
    ScreenService,
    JwtAuthGuard,
    PermissionsGuard,
    AuthService,
    ListActiveSessionsService,
    RevokeSessionService,
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
    UploadConversionSourceService,
    GetConversionResultService,
    ConversionScreenService,
    MongoScreenRepository,
    GetFieldMappingService,
    SaveFieldMappingService,
    GetMethodMappingService,
    SaveMethodMappingService,
    CreatePartnerService,
    ListPartnersService,
    RuleValidatorService,
    ExportCodeService,
    ErrorLogService,
    BuildValidationContextService,
    PrepareAiValidationContextService,
    ValidationSecretRedactorService,
    ExecuteAiValidationService,
    ValidationReadService,
    AiValidationRuntimeGuard,
    TriggerAiValidationService,
    ReconcileValidationRunService,
    ReviewValidationFindingService,
    ValidationWorkerRunner,
    FakeAiValidatorAdapter,
    OpenAiValidatorAdapter,
    aiValidatorProvider,
    MongoErrorLogRepository,
    ConversionWorkerRunner,
    BillingService,
    PaymentService,
    UsageService,
    MongoSubscriptionRepository,
    MongoInvoiceRepository,
    MongoPaymentRepository,
    MongoPlanRepository,
    MongoBankConfigRepository,
    LocalDiskStorageAdapter,
    BmsDspfConversionAdapter,
    CobolJavaConversionAdapter,
    { provide: MFA_SECURITY, useExisting: MfaSecurityService },
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    { provide: ORGANIZATION_REPOSITORY, useClass: MongoOrganizationRepository },
    { provide: SESSION_REPOSITORY, useClass: MongoSessionRepository },
    { provide: AUDIT_REPOSITORY, useClass: MongoAuditRepository },
    { provide: PROJECT_REPOSITORY, useClass: MongoProjectRepository },
    { provide: CONVERSION_JOB_REPOSITORY, useClass: MongoConversionJobRepository },
    { provide: VALIDATION_REPOSITORY, useClass: MongoValidationRepository },
    { provide: SUBSCRIPTION_REPOSITORY, useClass: MongoSubscriptionRepository },
    { provide: INVOICE_REPOSITORY, useClass: MongoInvoiceRepository },
    { provide: PAYMENT_REPOSITORY, useClass: MongoPaymentRepository },
    { provide: PLAN_REPOSITORY, useClass: MongoPlanRepository },
    { provide: BANK_CONFIG_REPOSITORY, useClass: MongoBankConfigRepository },
    { provide: FIELD_MAPPING_REPOSITORY, useClass: MongoFieldMappingRepository },
    { provide: METHOD_MAPPING_REPOSITORY, useClass: MongoMethodMappingRepository },
    { provide: PARTNER_REPOSITORY, useClass: MongoPartnerRepository },
    { provide: ERROR_LOG_REPOSITORY, useExisting: MongoErrorLogRepository },
    { provide: VALIDATION_RUN_REPOSITORY, useClass: MongoValidationRunRepository },
    { provide: VALIDATION_FINDING_REPOSITORY, useClass: MongoValidationFindingRepository },
    { provide: VALIDATION_QUEUE, useClass: BullMqValidationQueue },
    { provide: SCREEN_REPOSITORY, useExisting: MongoScreenRepository },
    { provide: CONVERSION_QUEUE, useClass: BullMqConversionQueue },
    { provide: CONVERSION_ENGINE, useClass: ConversionEngineRouter },
    { provide: STORAGE_PORT, useExisting: LocalDiskStorageAdapter },
    { provide: EMAIL_PORT, useClass: SmtpEmailAdapter },
    { provide: BILLING_USAGE_REPOSITORY, useClass: MongoBillingUsageRepository },
    { provide: PASSWORD_RESET_REPOSITORY, useClass: MongoPasswordResetRepository },
    { provide: EMAIL_VERIFICATION_REPOSITORY, useClass: MongoEmailVerificationRepository },
  ],
  exports: [ConversionWorkerRunner, ValidationWorkerRunner],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
