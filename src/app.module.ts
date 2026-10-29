import { Lead, LeadSchema } from './modules/crm/infrastructure/lead.schema';
import { LEAD_REPOSITORY } from './modules/crm/domain/lead.types';
import { MongoLeadRepository } from './modules/crm/infrastructure/mongo-lead.repository';
import { SALES_PERFORMANCE_SOURCE } from './modules/crm/domain/sales-performance-source.port';
import { MongoSalesPerformanceSource } from './modules/crm/infrastructure/mongo-sales-performance.source';
import { SALES_UNIT_OF_WORK } from './modules/crm/application/sales-unit-of-work.port';
import { MongoSalesUnitOfWork } from './modules/crm/infrastructure/mongo-sales-unit-of-work';
import { SALES_REVENUE_REPOSITORY } from './modules/billing/domain/sales-revenue.port';
import { MongoSalesRevenueRepository } from './modules/billing/infrastructure/persistence/mongo-sales-revenue.repository';
import { SALES_TEAM_ADMINISTRATION } from './modules/teams/domain/sales-team-administration.port';
import { SalesTeamAdministrationService } from './modules/teams/application/sales-team-administration.service';
import { CreateSalesLeadService } from './modules/crm/application/create-sales-lead.service';
import { ReassignSalesLeadService } from './modules/crm/application/reassign-sales-lead.service';
import { ConvertSalesLeadService } from './modules/crm/application/convert-sales-lead.service';
import { RecordSalesRevenueService } from './modules/crm/application/record-sales-revenue.service';
import { GetSalesLeadService } from './modules/crm/application/get-sales-lead.service';
import { SalesController } from './modules/crm/presentation/sales.controller';
import { SalesCrmController } from './modules/crm/presentation/sales-crm.controller';
import { SalesCrmService } from './modules/crm/application/sales-crm.service';
import { AdminModule } from './modules/admin/admin.module';
import { CurrentSessionGuard } from './shared/security/current-session.guard';
import { SessionAssuranceModule } from './modules/auth/session-assurance.module';
import { Connection, Model } from 'mongoose';
import { TEAM_UNIT_OF_WORK } from './modules/teams/application/team-unit-of-work.port';
import { MongoTeamUnitOfWork } from './modules/teams/infrastructure/mongo-team-unit-of-work';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { Team, TeamSchema } from './modules/teams/infrastructure/team.schema';
import { MongoTeamRepository } from './modules/teams/infrastructure/mongo-team.repository';
import { TEAM_REPOSITORY } from './modules/teams/domain/team.types';
import { TeamAccessService } from './modules/teams/application/team-access.service';
import { SaveTeamService } from './modules/teams/application/save-team.service';
import { ListManagedTeamsService } from './modules/teams/application/list-managed-teams.service';
import { TeamsController } from './modules/teams/presentation/teams.controller';
import { GetTeamAdministrationService } from './modules/teams/application/get-team-administration.service';
import { GetSalesTeamPerformanceService } from './modules/teams/application/get-sales-team-performance.service';
import { TeamReportsController } from './modules/teams/presentation/team-reports.controller';
import { TeamJobAssignment, TeamJobAssignmentSchema } from './modules/teams/infrastructure/team-job-assignment.schema';
import { MongoTeamJobAssignmentRepository } from './modules/teams/infrastructure/mongo-team-job-assignment.repository';
import { TEAM_JOB_ASSIGNMENTS } from './modules/teams/domain/team-job-assignment.types';
import { AssignTeamJobService } from './modules/teams/application/assign-team-job.service';
import { RevokeTeamJobService } from './modules/teams/application/revoke-team-job.service';
import { ListTeamJobAssignmentsService } from './modules/teams/application/list-team-job-assignments.service';
import { GetTeamWorkloadService } from './modules/teams/application/get-team-workload.service';
import { TeamJobAssignmentsController } from './modules/teams/presentation/team-job-assignments.controller';
import { CONVERSION_WORKLOAD } from './modules/conversions/domain/conversion-workload.port';
import { MongoConversionWorkloadReader } from './modules/conversions/infrastructure/mongo-conversion-workload.reader';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
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
import { Meeting, MeetingSchema } from './modules/meetings/infrastructure/meeting.schema';
import { MEETING_REPOSITORY } from './modules/meetings/domain/meeting.types';
import { MongoMeetingRepository } from './modules/meetings/infrastructure/mongo-meeting.repository';
import { CreateMeetingService } from './modules/meetings/application/create-meeting.service';
import { ListMeetingsService } from './modules/meetings/application/list-meetings.service';
import { MeetingController } from './modules/meetings/presentation/meeting.controller';
import { LEAD_REPOSITORY as UC58_LEAD_REPOSITORY } from './modules/leads/domain/lead.types';
import { MongoLeadRepository as MongoUc58LeadRepository } from './modules/leads/infrastructure/mongo-lead.repository';
import { Lead as Uc58Lead } from './modules/leads/infrastructure/lead.schema';
import { ListLeadsService } from './modules/leads/application/list-leads.service';
import { UpdateLeadStatusService } from './modules/leads/application/update-lead-status.service';
import { SendQuoteService } from './modules/leads/application/send-quote.service';
import { SEND_QUOTE_UNIT_OF_WORK } from './modules/leads/application/send-quote-unit-of-work.port';
import { MongoSendQuoteUnitOfWork } from './modules/leads/infrastructure/mongo-send-quote.unit-of-work';
import { LeadController } from './modules/leads/presentation/lead.controller';
import { Partner, PartnerSchema } from './modules/partners/infrastructure/partner.schema';
import { PARTNER_REPOSITORY } from './modules/partners/domain/partner.types';
import { MongoPartnerRepository } from './modules/partners/infrastructure/mongo-partner.repository';
import { CreatePartnerService } from './modules/partners/application/create-partner.service';
import { ListPartnersService } from './modules/partners/application/list-partners.service';
import { PartnerController } from './modules/partners/presentation/partner.controller';
import { MailService } from './shared/mail/mail.service';
import { GoogleCalendarService } from './shared/google/google-calendar.service';
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
import { BmsSanitizerService } from './modules/validation/application/bms-sanitizer.service';
import { BmsAiValidatorAdapter } from './modules/validation/infrastructure/bms-ai-validator.adapter';
import { BuildValidationContextService } from './modules/validation/application/build-validation-context.service';
import { ValidationReadService } from './modules/validation/application/validation-read.service';
import { ExecuteAiValidationService } from './modules/validation/application/execute-ai-validation.service';
import { PrepareAiValidationContextService } from './modules/validation/application/prepare-ai-validation-context.service';
import { ValidationSecretRedactorService } from './modules/validation/application/validation-secret-redactor.service';
import { FakeAiValidatorAdapter } from './modules/validation/infrastructure/fake-ai-validator.adapter';
import { OpenAiValidatorAdapter } from './modules/validation/infrastructure/openai-ai-validator.adapter';
import { GeminiAiValidatorAdapter } from './modules/validation/infrastructure/gemini-ai-validator.adapter';
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
import { SaveScreenCodeService } from './modules/conversions/application/save-screen-code.service';
import { FieldMappingController } from './modules/conversions/presentation/field-mapping.controller';
import { METHOD_MAPPING_REPOSITORY } from './modules/conversions/domain/method-mapping.types';
import { MongoMethodMappingRepository } from './modules/conversions/infrastructure/mongo-method-mapping.repository';
import { GetMethodMappingService } from './modules/conversions/application/get-method-mapping.service';
import { SaveMethodMappingService } from './modules/conversions/application/save-method-mapping.service';
import { MethodMappingController } from './modules/conversions/presentation/method-mapping.controller';
import { OnboardUserService } from './modules/users/application/onboard-user.service';
import { UpdateUserStatusService } from './modules/users/application/update-user-status.service';
import { UsersController } from './modules/users/presentation/users.controller';
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
import { ConversionProjectAccessService } from './modules/conversions/application/conversion-project-access.service';
import { ConversionsController } from './modules/conversions/presentation/conversions.controller';
import { HealthController } from './modules/health/health.controller';
import { ConversionWorkerRunner } from './modules/conversions/infrastructure/conversion-worker.runner';
import { ExportCodeService } from './modules/conversions/application/export-code.service';
import { ExportController } from './modules/conversions/presentation/export.controller';
import { PartnerExportController } from './modules/conversions/presentation/partner-export.controller';
import { PartnerBundleService } from './modules/conversions/application/partner-bundle.service';
import { PublishPartnerExportService } from './modules/conversions/application/publish-partner-export.service';
import {
  ExportBundle,
  ExportBundleSchema,
} from './modules/conversions/infrastructure/export-bundle.schema';
import { MongoExportBundleRepository } from './modules/conversions/infrastructure/mongo-export-bundle.repository';
import { MongoExportPublicationUnitOfWork } from './modules/conversions/infrastructure/mongo-export-publication.unit-of-work';
import {
  EXPORT_BUNDLE_REPOSITORY,
  EXPORT_PUBLICATION_UNIT_OF_WORK,
} from './modules/conversions/domain/export.types';
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
  QUOTE_REQUEST_REPOSITORY,
  SUBSCRIPTION_REPOSITORY,
} from './modules/billing/domain/billing.repository.interface';
import { MongoSubscriptionRepository } from './modules/billing/infrastructure/persistence/mongo-subscription.repository';
import { MongoInvoiceRepository } from './modules/billing/infrastructure/persistence/mongo-invoice.repository';
import { MongoPaymentRepository } from './modules/billing/infrastructure/persistence/mongo-payment.repository';
import { MongoPlanRepository } from './modules/billing/infrastructure/persistence/mongo-plan.repository';
import { MongoBankConfigRepository } from './modules/billing/infrastructure/persistence/mongo-bank-config.repository';
import { MongoBillingUsageRepository } from './modules/billing/infrastructure/persistence/mongo-billing-usage.repository';
import { MongoQuoteRequestRepository } from './modules/billing/infrastructure/persistence/mongo-quote-request.repository';
import {
  QuoteRequest,
  QuoteRequestSchema,
} from './modules/billing/infrastructure/quote-request.schema';

import { RbacModule } from './modules/rbac/rbac.module';
import { MenuModule } from './modules/menus/menu.module';

import { VALIDATION_REPOSITORY } from './modules/conversions/domain/validation.types';
import { MongoValidationRepository } from './modules/conversions/infrastructure/mongo-validation.repository';
import { RuleValidatorService } from './modules/conversions/application/rule-validator.service';
import { LegacyValidationService } from './modules/conversions/application/legacy-validation.service';
import {
  LegacyValidationRun,
  LegacyValidationFinding,
  ValidationRunSchema as LegacyValidationRunSchema,
  ValidationFindingSchema as LegacyValidationFindingSchema,
} from './modules/conversions/infrastructure/validation.schema';
import { ValidationController as RuleValidationController } from './modules/conversions/presentation/validation.controller';
import {
  ConversionQualityReview,
  ConversionQualityReviewSchema,
} from './modules/conversions/infrastructure/conversion-quality-review.schema';
import { CONVERSION_QUALITY_REVIEW_REPOSITORY } from './modules/conversions/domain/conversion-quality-review.types';
import { MongoConversionQualityReviewRepository } from './modules/conversions/infrastructure/mongo-conversion-quality-review.repository';
import { GetConversionQualityReviewService } from './modules/conversions/application/get-conversion-quality-review.service';
import { SubmitConversionQualityReviewService } from './modules/conversions/application/submit-conversion-quality-review.service';
import { QualityReviewController } from './modules/conversions/presentation/quality-review.controller';

import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: environmentValidationSchema }),
    JwtModule.register({ global: true }),
    MongooseModule.forRootAsync({ useFactory: () => ({ uri: process.env.MONGODB_URI }) }),
    SessionAssuranceModule,
    AuditModule,
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Team.name, schema: TeamSchema },
      { name: TeamJobAssignment.name, schema: TeamJobAssignmentSchema },
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
      { name: Meeting.name, schema: MeetingSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Partner.name, schema: PartnerSchema },
      { name: ErrorLog.name, schema: ErrorLogSchema },
      { name: ScreenDocument.name, schema: ConversionScreenSchema },
      { name: Screen.name, schema: ScreenSchema },
      { name: ValidationRun.name, schema: ValidationRunSchema },
      { name: ValidationFinding.name, schema: ValidationFindingSchema },
      { name: LegacyValidationRun.name, schema: LegacyValidationRunSchema },
      { name: LegacyValidationFinding.name, schema: LegacyValidationFindingSchema },
      { name: QuoteRequest.name, schema: QuoteRequestSchema },
      { name: ConversionQualityReview.name, schema: ConversionQualityReviewSchema },
      { name: ExportBundle.name, schema: ExportBundleSchema },
    ]),
    RbacModule,
    MenuModule,
    AdminModule,
  ],
  controllers: [
    SalesController,
    SalesCrmController,
    TeamsController,
    TeamReportsController,
    TeamJobAssignmentsController,
    AuthController,
    ProjectsController,
    ConversionsController,
    QualityReviewController,
    ConversionSourceController,
    ScreensController,
    ConversionScreensController,
    FieldMappingController,
    MethodMappingController,
    MeetingController,
    LeadController,
    PartnerController,
    UsersController,
    ExportController,
    PartnerExportController,
    ErrorLogController,
    ValidationController,
    RuleValidationController,
    HealthController,
    BillingController,
    PaymentController,
  ],
  providers: [
    { provide: LEAD_REPOSITORY, useClass: MongoLeadRepository },
    { provide: SALES_PERFORMANCE_SOURCE, useClass: MongoSalesPerformanceSource },
    { provide: SALES_REVENUE_REPOSITORY, useClass: MongoSalesRevenueRepository },
    { provide: SALES_TEAM_ADMINISTRATION, useClass: SalesTeamAdministrationService },
    CreateSalesLeadService,
    ReassignSalesLeadService,
    ConvertSalesLeadService,
    RecordSalesRevenueService,
    GetSalesLeadService,
    SalesCrmService,
    {
      provide: SALES_UNIT_OF_WORK,
      inject: [
        getConnectionToken(),
        getModelToken(Lead.name),
        getModelToken(Payment.name),
        getModelToken(AuditLog.name),
      ],
      useFactory: (
        connection: Connection,
        leads: Model<Lead>,
        payments: Model<Payment>,
        audits: Model<AuditLog>,
      ) =>
        new MongoSalesUnitOfWork(
          connection,
          new MongoLeadRepository(leads),
          (session, selectedConnection) =>
            new MongoSalesRevenueRepository(payments).inTransaction(session, selectedConnection),
          (session, selectedConnection) =>
            new MongoAuditRepository(audits).inTransaction(session, selectedConnection),
        ),
    },
    {
      provide: TEAM_UNIT_OF_WORK,
      inject: [
        getConnectionToken(),
        getModelToken(Team.name),
        getModelToken(TeamJobAssignment.name),
        getModelToken(AuditLog.name),
      ],
      useFactory: (
        connection: Connection,
        teams: Model<Team>,
        assignments: Model<TeamJobAssignment>,
        audits: Model<AuditLog>,
      ) =>
        new MongoTeamUnitOfWork(
          connection,
          new MongoTeamRepository(teams),
          new MongoTeamJobAssignmentRepository(assignments),
          (session, selectedConnection) =>
            new MongoAuditRepository(audits).inTransaction(session, selectedConnection),
        ),
    },
    TeamAccessService,
    GetTeamAdministrationService,
    GetSalesTeamPerformanceService,
    AssignTeamJobService,
    RevokeTeamJobService,
    ListTeamJobAssignmentsService,
    GetTeamWorkloadService,
    { provide: TEAM_JOB_ASSIGNMENTS, useClass: MongoTeamJobAssignmentRepository },
    { provide: CONVERSION_WORKLOAD, useClass: MongoConversionWorkloadReader },
    SaveTeamService,
    ListManagedTeamsService,
    { provide: TEAM_REPOSITORY, useClass: MongoTeamRepository },
    ScreenService,
    JwtAuthGuard,
    CurrentSessionGuard,
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
    ConversionProjectAccessService,
    UploadConversionSourceService,
    GetConversionResultService,
    GetConversionQualityReviewService,
    SubmitConversionQualityReviewService,
    ConversionScreenService,
    MongoScreenRepository,
    GetFieldMappingService,
    SaveFieldMappingService,
    SaveScreenCodeService,
    GetMethodMappingService,
    SaveMethodMappingService,
    OnboardUserService,
    UpdateUserStatusService,
    RuleValidatorService,
    LegacyValidationService,
    ExportCodeService,
    PartnerBundleService,
    PublishPartnerExportService,
    { provide: EXPORT_BUNDLE_REPOSITORY, useClass: MongoExportBundleRepository },
    {
      provide: EXPORT_PUBLICATION_UNIT_OF_WORK,
      inject: [
        getConnectionToken(),
        getModelToken(Project.name),
        getModelToken(Partner.name),
        getModelToken(ExportBundle.name),
        getModelToken(AuditLog.name),
      ],
      useFactory: (
        connection: Connection,
        projects: Model<Project>,
        partners: Model<Partner>,
        bundles: Model<ExportBundle>,
        audits: Model<AuditLog>,
      ) =>
        new MongoExportPublicationUnitOfWork(
          connection,
          projects,
          partners,
          bundles,
          (session, selectedConnection) =>
            new MongoAuditRepository(audits).inTransaction(session, selectedConnection),
        ),
    },
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
    GeminiAiValidatorAdapter,
    BmsSanitizerService,
    BmsAiValidatorAdapter,
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
    {
      provide: CONVERSION_QUALITY_REVIEW_REPOSITORY,
      useClass: MongoConversionQualityReviewRepository,
    },
    { provide: VALIDATION_REPOSITORY, useClass: MongoValidationRepository },
    { provide: SUBSCRIPTION_REPOSITORY, useClass: MongoSubscriptionRepository },
    { provide: INVOICE_REPOSITORY, useClass: MongoInvoiceRepository },
    { provide: PAYMENT_REPOSITORY, useClass: MongoPaymentRepository },
    { provide: PLAN_REPOSITORY, useClass: MongoPlanRepository },
    { provide: BANK_CONFIG_REPOSITORY, useClass: MongoBankConfigRepository },
    { provide: FIELD_MAPPING_REPOSITORY, useClass: MongoFieldMappingRepository },
    { provide: METHOD_MAPPING_REPOSITORY, useClass: MongoMethodMappingRepository },
    { provide: MEETING_REPOSITORY, useClass: MongoMeetingRepository },
    { provide: PARTNER_REPOSITORY, useClass: MongoPartnerRepository },
    CreatePartnerService,
    ListPartnersService,
    CreateMeetingService,
    ListMeetingsService,
    { provide: UC58_LEAD_REPOSITORY, useClass: MongoUc58LeadRepository },
    {
      provide: SEND_QUOTE_UNIT_OF_WORK,
      inject: [getConnectionToken(), getModelToken(Lead.name), getModelToken(AuditLog.name)],
      useFactory: (connection: Connection, leads: Model<Lead>, audits: Model<AuditLog>) =>
        new MongoSendQuoteUnitOfWork(
          connection,
          new MongoUc58LeadRepository(leads as unknown as Model<Uc58Lead>),
          (session, selectedConnection) =>
            new MongoAuditRepository(audits).inTransaction(session, selectedConnection),
        ),
    },
    ListLeadsService,
    UpdateLeadStatusService,
    SendQuoteService,
    MailService,
    GoogleCalendarService,
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
    MongoQuoteRequestRepository,
    { provide: QUOTE_REQUEST_REPOSITORY, useClass: MongoQuoteRequestRepository },
  ],
  exports: [ConversionWorkerRunner, ValidationWorkerRunner],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
