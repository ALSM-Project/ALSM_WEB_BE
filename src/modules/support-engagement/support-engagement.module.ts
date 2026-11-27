import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { SessionAssuranceModule } from '../auth/session-assurance.module';
import { RbacModule } from '../rbac/rbac.module';
import { SupportAttachment, SupportAttachmentSchema } from './infrastructure/support-attachment.schema';
import { SupportFeedback, SupportFeedbackSchema } from './infrastructure/support-feedback.schema';
import { SupportFeedbackService } from './application/support-feedback.service';
import { SupportAttachmentController } from './presentation/support-attachment.controller';
import { SupportFeedbackController } from './presentation/support-feedback.controller';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    SessionAssuranceModule,
    RbacModule,
    MongooseModule.forFeature([
      { name: SupportAttachment.name, schema: SupportAttachmentSchema },
      { name: SupportFeedback.name, schema: SupportFeedbackSchema },
    ]),
  ],
  controllers: [SupportAttachmentController, SupportFeedbackController],
  providers: [SupportFeedbackService],
  exports: [SupportFeedbackService],
})
export class SupportEngagementModule {}
