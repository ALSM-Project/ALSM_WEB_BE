import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequireAnyPermissions } from '../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { SupportFeedbackService } from '../application/support-feedback.service';
import {
  CreateFeedbackDto,
  FeedbackSummaryResult,
  SupportFeedbackItem,
  UpdateFeedbackStatusDto,
} from './support-feedback.dto';

@ApiTags('Support Feedback & Reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('support/feedback')
export class SupportFeedbackController {
  constructor(private readonly feedbackService: SupportFeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit user feedback & rating' })
  async submitFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFeedbackDto,
  ): Promise<SupportFeedbackItem> {
    return this.feedbackService.submitFeedback(
      {
        userId: user.userId,
        email: user.email,
        fullName: (user as any).fullName,
        organizationId: (user as any).organizationId,
      },
      dto,
    );
  }

  @Get('my')
  @ApiOperation({ summary: 'List current user feedback history' })
  async listMyFeedback(@CurrentUser() user: AuthenticatedUser): Promise<SupportFeedbackItem[]> {
    return this.feedbackService.listMyFeedback({
      userId: user.userId,
      email: user.email,
    });
  }

  @Get('summary')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermissions('feedback.summary.view', 'users.manage', 'organizations.view')
  @ApiOperation({ summary: 'View aggregated feedback ratings and summary (Admin)' })
  async getSummary(): Promise<FeedbackSummaryResult> {
    return this.feedbackService.getSummary();
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequireAnyPermissions('feedback.view', 'conversations.view', 'organizations.impersonate', 'users.manage')
  @ApiOperation({ summary: 'List all submitted customer feedback (Support Staff & Admin)' })
  async listAllFeedback(
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('rating') rating?: string,
    @Query('search') search?: string,
  ): Promise<SupportFeedbackItem[]> {
    return this.feedbackService.listAllFeedback({ category, status, rating, search });
  }

  @Patch(':id/status')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermissions('feedback.manage', 'conversations.create', 'organizations.impersonate', 'users.manage')
  @ApiOperation({ summary: 'Update feedback review status and staff notes' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateFeedbackStatusDto,
  ): Promise<SupportFeedbackItem> {
    return this.feedbackService.updateFeedbackStatus(
      id,
      {
        userId: user.userId,
        email: user.email,
        fullName: (user as any).fullName,
      },
      dto,
    );
  }
}
