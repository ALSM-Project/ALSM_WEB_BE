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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequireAnyPermissions, RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { MeetingRequestService } from '../application/meeting-request.service';
import {
  AddInternalNoteDto,
  AssignSalesDto,
  CancelMeetingDto,
  ConfirmMeetingDto,
  CreateEnterpriseQuoteFromMeetingDto,
  CreateMeetingRequestDto,
  ListMeetingRequestsQueryDto,
  ProposeMeetingSlotsDto,
  RecordOutcomeDto,
  RescheduleMeetingDto,
} from './meeting-request.dto';

@ApiTags('Meeting & Consultation Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('meeting-requests')
export class MeetingRequestController {
  constructor(private readonly meetingRequestService: MeetingRequestService) {}

  @Get()
  @RequireAnyPermissions('meetings.view', 'billing.quotes.manage')
  @ApiOperation({ summary: 'List meeting & consultation requests with filtering and pagination' })
  async listMeetingRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') orgHeader: string | undefined,
    @Query() query: ListMeetingRequestsQueryDto,
  ) {
    return this.meetingRequestService.listMeetingRequests(query, {
      userId: user?.userId,
      email: user?.email,
      organizationId: query.organizationId || orgHeader,
    });
  }

  @Post()
  @RequireAnyPermissions('meetings.create', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Create a new customer consultation request' })
  async createMeetingRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') orgHeader: string | undefined,
    @Body() dto: CreateMeetingRequestDto,
  ) {
    return this.meetingRequestService.createMeetingRequest(dto, {
      userId: user.userId,
      email: user.email,
      organizationId: dto.organizationId || orgHeader,
    });
  }

  @Get('consultation-types')
  @RequireAnyPermissions('meetings.view', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Get available consultation types catalog' })
  getConsultationTypes() {
    return this.meetingRequestService.getConsultationTypes();
  }

  @Get('calendar-status')
  @RequireAnyPermissions('meetings.view', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Get Google Calendar and Meet integration configuration status' })
  getCalendarStatus() {
    return this.meetingRequestService.getCalendarStatus();
  }

  @Get('organization-members')
  @RequireAnyPermissions('meetings.view', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Get members strictly belonging to the caller organization' })
  async getOrganizationMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') orgHeader: string | undefined,
    @Query('organizationId') queryOrgId?: string,
  ) {
    return this.meetingRequestService.getOrganizationMembers({
      userId: user?.userId,
      email: user?.email,
      organizationId: queryOrgId || orgHeader,
    });
  }

  @Get(':id')
  @RequireAnyPermissions('meetings.view', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Get detailed consultation request by ID' })
  async getMeetingRequest(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.meetingRequestService.getMeetingRequest(id, {
      userId: user?.userId,
      email: user?.email,
    });
  }

  @Patch(':id/assign')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Assign a sales representative to consultation request' })
  async assignSales(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AssignSalesDto,
  ) {
    return this.meetingRequestService.assignSales(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/propose-slots')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Propose meeting time slots to customer' })
  async proposeMeetingSlots(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ProposeMeetingSlotsDto,
  ) {
    return this.meetingRequestService.proposeMeetingSlots(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/confirm')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Confirm meeting time and generate Google Meet conference link' })
  async confirmMeeting(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmMeetingDto,
  ) {
    return this.meetingRequestService.confirmMeeting(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/reschedule')
  @RequireAnyPermissions('meetings.create', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Reschedule an existing meeting' })
  async rescheduleMeeting(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RescheduleMeetingDto,
  ) {
    return this.meetingRequestService.rescheduleMeeting(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/cancel')
  @RequireAnyPermissions('meetings.create', 'billing.quotes.manage')
  @ApiOperation({ summary: 'Cancel consultation meeting request' })
  async cancelMeeting(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CancelMeetingDto,
  ) {
    return this.meetingRequestService.cancelMeeting(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/notes')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Add internal note to consultation request' })
  async addInternalNote(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddInternalNoteDto,
  ) {
    return this.meetingRequestService.addInternalNote(id, dto.content, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/record-outcome')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Record consultation meeting outcome and qualification summary' })
  async recordOutcome(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordOutcomeDto,
  ) {
    return this.meetingRequestService.recordOutcome(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }

  @Post(':id/create-quote')
  @RequirePermissions('billing.quotes.manage')
  @ApiOperation({ summary: 'Initiate enterprise quote draft directly from consultation outcomes' })
  async createEnterpriseQuote(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEnterpriseQuoteFromMeetingDto,
  ) {
    return this.meetingRequestService.createEnterpriseQuote(id, dto, {
      userId: user.userId,
      email: user.email,
    });
  }
}
