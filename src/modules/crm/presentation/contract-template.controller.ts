import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { ContractTemplateService } from '../application/contract-template.service';
import { CreateContractTemplateVersionDto, RejectContractTemplateVersionDto } from './contract-template.dto';

@ApiTags('Contract Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CurrentSessionGuard, PermissionsGuard)
@Controller()
export class ContractTemplateController {
  constructor(private readonly templates: ContractTemplateService) {}

  @Get('sales/contract-templates/approved')
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'List immutable Legal-approved contract template versions available to Sales' })
  listApproved() {
    return this.templates.listApproved();
  }

  @Get('admin/contract-templates')
  @RequirePermissions('sales.contract-templates.manage')
  @ApiOperation({ summary: 'List immutable contract template versions for authorized administration' })
  listAllVersions() {
    return this.templates.listAllVersions();
  }

  @Post('admin/contract-templates')
  @RequirePermissions('sales.contract-templates.manage')
  @ApiOperation({ summary: 'Create a draft legal template version; this does not approve or publish its content' })
  createVersion(@CurrentUser() actor: AuthenticatedUser, @Body() body: CreateContractTemplateVersionDto) {
    return this.templates.createVersion({ ...body, allowCreate: true, actor });
  }

  @Post('admin/contract-templates/:templateId/versions')
  @RequirePermissions('sales.contract-templates.manage')
  @ApiOperation({ summary: 'Create a new immutable draft version under an existing template' })
  createNextVersion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('templateId') templateId: string,
    @Body() body: CreateContractTemplateVersionDto,
  ) {
    return this.templates.createVersion({ ...body, templateId, actor });
  }

  @Get('admin/contract-templates/:templateId/versions')
  @RequirePermissions('sales.contract-templates.manage')
  @ApiOperation({ summary: 'List versions in the authorized template administration scope' })
  listVersions(@Param('templateId') templateId: string) {
    return this.templates.listVersions(templateId);
  }

  @Post('admin/contract-template-versions/:versionId/approve')
  @RequirePermissions('sales.contract-templates.approve')
  @ApiOperation({ summary: 'Approve an immutable template version as Legal-ready; creator and approver must differ' })
  approve(@CurrentUser() actor: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.templates.approve({ versionId, actor });
  }

  @Post('admin/contract-template-versions/:versionId/reject')
  @RequirePermissions('sales.contract-templates.approve')
  @ApiOperation({ summary: 'Reject a legal template draft with a mandatory reason' })
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() body: RejectContractTemplateVersionDto,
  ) {
    return this.templates.reject({ versionId, reason: body.reason, actor });
  }
}
