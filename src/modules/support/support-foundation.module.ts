import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { SessionAssuranceModule } from '../auth/session-assurance.module';
import { SupportOrganizationDirectoryModule } from '../organizations/support-organization-directory.module';
import { SupportStaffAuthorityModule } from '../rbac/support-staff-authority.module';
import { AuthorizeSupportContextReadService } from './application/authorize-support-context-read.service';
import { EnterSupportContextService } from './application/enter-support-context.service';
import { ExitSupportContextService } from './application/exit-support-context.service';
import { SearchSupportOrganizationsService } from './application/search-support-organizations.service';
import { SUPPORT_CLOCK, SUPPORT_CONTEXT_UNIT_OF_WORK } from './application/support-context.ports';
import { SupportStaffAccessService } from './application/support-staff-access.service';
import { MongoSupportContextUnitOfWork } from './infrastructure/mongo-support-context.unit-of-work';
import {
  SUPPORT_CONTEXT_MODEL,
  SupportContextSchema,
} from './infrastructure/support-context.schema';
import { SupportContextController } from './presentation/support-context.controller';
import { SupportProjectReaderModule } from '../projects/support-project-reader.module';
import { SupportScreenReaderModule } from '../screens/support-screen-reader.module';
import { SupportConversionReaderModule } from '../conversions/support-conversion-reader.module';
import { SupportFindingReaderModule } from '../validation/support-finding-reader.module';
import { ReadSupportWorkspaceService } from './application/read-support-workspace.service';
import { SupportWorkspaceController } from './presentation/support-workspace.controller';
import { SupportOperationEvidenceModule } from '../audit/support-operation-evidence.module';
import { SUPPORT_INSPECTION } from './application/support-inspection.port';
import { MongoSupportInspection } from './infrastructure/mongo-support-inspection';
import { RecoverSupportContextService } from './application/recover-support-context.service';
import { SupportRecoveryController } from './presentation/support-recovery.controller';

/** ISOLATED: deliberately not imported by AppModule/worker or enabled by any config flag.
 * Hoang's independent QA/Security review and separate activation approval are required.
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    SessionAssuranceModule,
    AuditModule,
    SupportOperationEvidenceModule,
    SupportStaffAuthorityModule,
    SupportOrganizationDirectoryModule,
    SupportProjectReaderModule,
    SupportScreenReaderModule,
    SupportConversionReaderModule,
    SupportFindingReaderModule,
    MongooseModule.forFeature([{ name: SUPPORT_CONTEXT_MODEL, schema: SupportContextSchema }]),
  ],
  controllers: [SupportContextController, SupportWorkspaceController, SupportRecoveryController],
  providers: [
    SupportStaffAccessService,
    SearchSupportOrganizationsService,
    EnterSupportContextService,
    ExitSupportContextService,
    AuthorizeSupportContextReadService,
    ReadSupportWorkspaceService,
    RecoverSupportContextService,
    { provide: SUPPORT_INSPECTION, useClass: MongoSupportInspection },
    { provide: SUPPORT_CLOCK, useValue: { now: () => new Date() } },
    { provide: SUPPORT_CONTEXT_UNIT_OF_WORK, useClass: MongoSupportContextUnitOfWork },
  ],
  exports: [AuthorizeSupportContextReadService],
})
export class SupportFoundationModule {}
