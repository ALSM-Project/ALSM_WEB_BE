import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  INestApplication,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Connection } from 'mongoose';
import { ApiExceptionFilter } from '../../src/shared/errors/api-exception.filter';
import { CurrentUser } from '../../src/shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../src/shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../src/shared/logging/request-id.middleware';
import { AuthService } from '../../src/modules/auth/application/auth.service';
import { LoginDto } from '../../src/modules/auth/presentation/auth.dto';
import { EmailVerificationService } from '../../src/modules/auth/application/email-verification.service';
import { EMAIL_PORT } from '../../src/modules/auth/domain/email.port';
import { EMAIL_VERIFICATION_REPOSITORY } from '../../src/modules/auth/domain/email-verification.repository';
import { SmtpEmailAdapter } from '../../src/modules/auth/infrastructure/smtp-email.adapter';
import { MongoEmailVerificationRepository } from '../../src/modules/auth/infrastructure/mongo-email-verification.repository';
import {
  EmailVerification,
  EmailVerificationSchema,
} from '../../src/modules/auth/infrastructure/email-verification.schema';
import { USER_REPOSITORY } from '../../src/modules/users/domain/user.repository';
import { MongoUserRepository } from '../../src/modules/users/infrastructure/mongo-user.repository';
import { User, UserSchema } from '../../src/modules/users/infrastructure/user.schema';
import {
  Organization,
  OrganizationSchema,
} from '../../src/modules/organizations/infrastructure/organization.schema';
import { ORGANIZATION_REPOSITORY } from '../../src/modules/organizations/domain/organization.repository';
import { MongoOrganizationRepository } from '../../src/modules/organizations/infrastructure/mongo-organization.repository';
import { EffectivePermissionsService } from '../../src/modules/rbac/application/effective-permissions.service';
import { RBAC_REPOSITORY } from '../../src/modules/rbac/domain/rbac.repository.interface';
import { MongoRbacRepository } from '../../src/modules/rbac/infrastructure/persistence/mongo-rbac.repository';
import { Role, RoleSchema } from '../../src/modules/rbac/infrastructure/schemas/role.schema';
import {
  Permission,
  PermissionSchema,
} from '../../src/modules/rbac/infrastructure/schemas/permission.schema';
import {
  RolePermission,
  RolePermissionSchema,
} from '../../src/modules/rbac/infrastructure/schemas/role-permission.schema';
import {
  UserRole,
  UserRoleSchema,
} from '../../src/modules/rbac/infrastructure/schemas/user-role.schema';
import {
  TemporaryRole,
  TemporaryRoleSchema,
} from '../../src/modules/rbac/infrastructure/schemas/temporary-role.schema';
import { SupportFoundationModule } from '../../src/modules/support/support-foundation.module';
import {
  SUPPORT_CLOCK,
  SupportClock,
} from '../../src/modules/support/application/support-context.ports';
import { verifyOwnedUc66Uri } from './owned-environment';

/** Test-owned HTTP wrapper delegates to the unchanged real password/session/profile services. */
@Controller('auth')
class Uc66TestAuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body.email, body.password, 'UC66-05A isolated test');
  }
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.userId);
  }
}

/** No AppModule, worker, .env, service mocks, guard overrides, role seeds or arbitrary URI. */
export async function createUc66TestApp(
  uri: string,
  secret: string,
  clock: SupportClock,
  configure?: (app: INestApplication) => void,
) {
  await verifyOwnedUc66Uri(uri);
  const ref = await Test.createTestingModule({
    imports: [
      ConfigModule,
      JwtModule.register({}),
      MongooseModule.forRoot(uri, { serverSelectionTimeoutMS: 3000 }),
      MongooseModule.forFeature([
        { name: User.name, schema: UserSchema },
        { name: Organization.name, schema: OrganizationSchema },
        { name: Role.name, schema: RoleSchema },
        { name: Permission.name, schema: PermissionSchema },
        { name: RolePermission.name, schema: RolePermissionSchema },
        { name: UserRole.name, schema: UserRoleSchema },
        { name: TemporaryRole.name, schema: TemporaryRoleSchema },
        { name: EmailVerification.name, schema: EmailVerificationSchema },
      ]),
      SupportFoundationModule,
    ],
    controllers: [Uc66TestAuthController],
    providers: [
      AuthService,
      EffectivePermissionsService,
      EmailVerificationService,
      { provide: USER_REPOSITORY, useClass: MongoUserRepository },
      { provide: ORGANIZATION_REPOSITORY, useClass: MongoOrganizationRepository },
      { provide: RBAC_REPOSITORY, useClass: MongoRbacRepository },
      { provide: EMAIL_PORT, useClass: SmtpEmailAdapter },
      { provide: EMAIL_VERIFICATION_REPOSITORY, useClass: MongoEmailVerificationRepository },
    ],
  })
    .overrideProvider(ConfigService)
    .useValue(
      new ConfigService({
        JWT_ACCESS_SECRET: secret,
        JWT_REFRESH_SECRET: secret + '-refresh',
        JWT_ACCESS_EXPIRES_IN: '1h',
        JWT_REFRESH_EXPIRES_IN: '2h',
      }),
    )
    .overrideProvider(SUPPORT_CLOCK)
    .useValue(clock)
    .compile();
  const app = ref.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: ['http://127.0.0.1:3017', 'http://localhost:3017'],
    exposedHeaders: ['X-UC66-Owned-Test'],
  });
  app.use(
    (_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
      res.setHeader('X-UC66-Owned-Test', new URL(uri).pathname.slice(1));
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  configure?.(app);
  await app.init();
  const connection = app.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(connection.models).map((model) => model.init()));
  await connection.collection('audit_logs').createIndex(
    {
      actorUserId: 1,
      organizationId: 1,
      'metadata.originalSessionId': 1,
      'metadata.contextId': 1,
      'metadata.operationId': 1,
    },
    { name: 'uc66_test_operation_evidence' },
  );
  return { app, connection };
}
