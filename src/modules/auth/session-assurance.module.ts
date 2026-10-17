import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RequireCurrentSessionService } from './application/require-current-session.service';
import { SESSION_REPOSITORY } from './domain/session.repository';
import { MongoSessionRepository } from './infrastructure/mongo-session.repository';
import { UserSession, UserSessionSchema } from './infrastructure/user-session.schema';
import { USER_REPOSITORY } from '../users/domain/user.repository';
import { MongoUserRepository } from '../users/infrastructure/mongo-user.repository';
import { User, UserSchema } from '../users/infrastructure/user.schema';

/** Share only ordinary session assurance with guards in every controller module. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserSession.name, schema: UserSessionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: MongoSessionRepository },
    { provide: USER_REPOSITORY, useClass: MongoUserRepository },
    RequireCurrentSessionService,
  ],
  exports: [RequireCurrentSessionService],
})
export class SessionAssuranceModule {}
