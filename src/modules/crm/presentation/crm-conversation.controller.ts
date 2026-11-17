import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequireAnyPermissions, RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CrmConversationService } from '../application/crm-conversation.service';
import {
  CreateConversationDto,
  PostMessageDto,
  UpdateConversationStatusDto,
  CrmConversationItem,
  CrmConversationMessageItem,
  ConvertToLeadDto,
  ConvertToLeadResult,
  CheckLeadStatusResult,
} from './crm-conversation.dto';

@ApiTags('CRM & Sales - Customer Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('crm/conversations')
export class CrmConversationController {
  constructor(private readonly conversationService: CrmConversationService) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequireAnyPermissions('conversations.view', 'sales.leads.view')
  @ApiOperation({ summary: 'List CRM customer conversations with filters' })
  async listConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader?: string,
    @Query('leadId') leadId?: string,
    @Query('organizationId') queryOrgId?: string,
    @Query('projectId') projectId?: string,
    @Query('type') conversationType?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('channel') channel?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ): Promise<CrmConversationItem[]> {
    return this.conversationService.listConversations(
      {
        leadId,
        organizationId: queryOrgId || organizationHeader,
        projectId,
        conversationType,
        status,
        search,
        channel,
        unreadOnly: unreadOnly === 'true',
      },
      {
        userId: user?.userId,
        email: user?.email,
      },
    );
  }

  @Get('my/active')
  @ApiOperation({ summary: 'Get or start customer active chat conversation (FE1)' })
  async getMyActiveConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyName') companyName?: string,
  ): Promise<CrmConversationItem> {
    const userName = (user as any).fullName || user.email?.split('@')[0] || 'Customer';
    return this.conversationService.getOrCreateCustomerConversation(
      user.email,
      userName,
      companyName,
    );
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequireAnyPermissions('conversations.create', 'sales.leads.manage')
  @ApiOperation({ summary: 'Initiate a new conversation with a customer or prospect' })
  async createConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader: string | undefined,
    @Body() dto: CreateConversationDto,
  ): Promise<CrmConversationItem> {
    const userName = (user as any).fullName || user.email || 'User';
    return this.conversationService.createConversation(
      user.userId,
      user.email,
      userName,
      {
        ...dto,
        organizationId: dto.organizationId || organizationHeader,
      },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific conversation' })
  async getConversation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CrmConversationItem> {
    return this.conversationService.getConversationById(id, user?.email);
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermissions('conversations.create', 'sales.leads.manage')
  @ApiOperation({ summary: 'Update conversation status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateConversationStatusDto,
  ): Promise<CrmConversationItem> {
    return this.conversationService.updateConversationStatus(id, dto.status);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'List message history for a conversation' })
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<CrmConversationMessageItem[]> {
    return this.conversationService.listMessages(id, user?.email);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Post a reply or internal note to a conversation' })
  async postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
  ): Promise<CrmConversationMessageItem> {
    const userName = (user as any).fullName || user.email || 'User';
    return this.conversationService.postMessage(
      user.userId,
      user.email,
      userName,
      id,
      dto,
    );
  }

  @Get(':id/check-lead')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sales.leads.view')
  @ApiOperation({ summary: 'Check if conversation is linked to lead and find existing leads by email' })
  async checkLeadStatus(@Param('id') id: string): Promise<CheckLeadStatusResult> {
    return this.conversationService.checkLeadStatus(id);
  }

  @Post(':id/convert-to-lead')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('sales.leads.manage')
  @ApiOperation({ summary: 'Convert conversation to CRM Lead' })
  async convertToLead(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader: string | undefined,
    @Param('id') id: string,
    @Body() dto: ConvertToLeadDto,
  ): Promise<ConvertToLeadResult> {
    const userName = (user as any).fullName || user.email || 'Sales Specialist';
    return this.conversationService.convertToLead(
      user.userId,
      user.email,
      userName,
      id,
      dto,
      organizationHeader || (user as any).organizationId,
    );
  }
}
