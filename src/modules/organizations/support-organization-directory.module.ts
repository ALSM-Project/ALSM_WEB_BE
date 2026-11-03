import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SUPPORT_ORGANIZATION_DIRECTORY } from './domain/support-organization-directory.port';
import { MongoSupportOrganizationDirectory } from './infrastructure/mongo-support-organization-directory';
import { Organization, OrganizationSchema } from './infrastructure/organization.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Organization.name, schema: OrganizationSchema }])],
  providers: [
    { provide: SUPPORT_ORGANIZATION_DIRECTORY, useClass: MongoSupportOrganizationDirectory },
  ],
  exports: [SUPPORT_ORGANIZATION_DIRECTORY],
})
export class SupportOrganizationDirectoryModule {}
