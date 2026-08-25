import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { environmentValidationSchema } from './config/environment.validation';
import { RequestIdMiddleware } from './shared/logging/request-id.middleware';
import { JwtAuthGuard } from './shared/security/jwt-auth.guard';
import { User, UserSchema } from './modules/users/infrastructure/user.schema';
import {
  Organization,
  OrganizationSchema,
} from './modules/organizations/infrastructure/organization.schema';
import { UserSession, UserSessionSchema } from './modules/auth/infrastructure/user-session.schema';
import { AuditLog, AuditLogSchema } from './modules/audit/infrastructure/audit-log.schema';
import { Project, ProjectSchema } from './modules/projects/infrastructure/project.schema';
import {
  ConversionJob,
  ConversionJobSchema,
} from './modules/conversions/infrastructure/conversion-job.schema';
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
import { AuthTokenIssuerService } from './modules/auth/application/auth-token-issuer.service';
import { RegisterUserService } from './modules/auth/application/register-user.service';
import { LoginUserService } from './modules/auth/application/login-user.service';
import { RefreshSessionService } from './modules/auth/application/refresh-session.service';
import { LogoutSessionService } from './modules/auth/application/logout-session.service';
import { GetMeService } from './modules/auth/application/get-me.service';
import { LoginWithGoogleService } from './modules/auth/application/login-with-google.service';
import { GoogleIdentityVerifierAdapter } from './modules/auth/infrastructure/google-identity-verifier.adapter';
import { GOOGLE_IDENTITY_PORT } from './modules/auth/domain/google-identity.port';
import { AuthController } from './modules/auth/presentation/auth.controller';
import { OrganizationAuthorizationService } from './modules/organizations/application/organization-authorization.service';
import { OrganizationContextService } from './modules/organizations/application/organization-context.service';
import { ProjectService } from './modules/projects/application/project.service';
import { ProjectsController } from './modules/projects/presentation/projects.controller';
import { ConversionJobService } from './modules/conversions/application/conversion-job.service';
import { ConversionsController } from './modules/conversions/presentation/conversions.controller';
import { HealthController } from './modules/health/health.controller';
import { ConversionWorkerRunner } from './modules/conversions/infrastructure/conversion-worker.runner';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: environmentValidationSchema }),
    JwtModule.register({}),
    MongooseModule.forRootAsync({ useFactory: () => ({ uri: process.env.MONGODB_URI }) }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: ConversionJob.name, schema: ConversionJobSchema },
    ]),
  ],
  controllers: [AuthController, ProjectsController, ConversionsController, HealthController],
  providers: [
    JwtAuthGuard,
    AuthTokenIssuerService,
    RegisterUserService,
    LoginUserService,
    RefreshSessionService,
    LogoutSessionService,
    GetMeService,
    LoginWithGoogleService,
    OrganizationContextService,
    OrganizationAuthorizationService,
    ProjectService,
    ConversionJobService,
    ConversionWorkerRunner,
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    { provide: ORGANIZATION_REPOSITORY, useClass: MongoOrganizationRepository },
    { provide: SESSION_REPOSITORY, useClass: MongoSessionRepository },
    { provide: GOOGLE_IDENTITY_PORT, useClass: GoogleIdentityVerifierAdapter },
    { provide: AUDIT_REPOSITORY, useClass: MongoAuditRepository },
    { provide: PROJECT_REPOSITORY, useClass: MongoProjectRepository },
    { provide: CONVERSION_JOB_REPOSITORY, useClass: MongoConversionJobRepository },
    { provide: CONVERSION_QUEUE, useClass: BullMqConversionQueue },
    { provide: CONVERSION_ENGINE, useClass: UnconfiguredConversionEngineAdapter },
  ],
  exports: [ConversionWorkerRunner],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
