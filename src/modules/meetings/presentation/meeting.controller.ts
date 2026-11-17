import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CreateMeetingService } from '../application/create-meeting.service';
import { ListMeetingsService } from '../application/list-meetings.service';
import { ManageMeetingService } from '../application/manage-meeting.service';
import { CreateMeetingDto, ListMeetingsQueryDto, UpdateMeetingDto, UpdateMeetingStatusDto } from './meeting.dto';
import { MeetingStatus } from '../domain/meeting.types';

@ApiTags('Meetings (UC-43)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('meetings')
export class MeetingController {
  constructor(
    private readonly createMeetingService: CreateMeetingService,
    private readonly listMeetingsService: ListMeetingsService,
    private readonly manageMeetingService: ManageMeetingService,
  ) {}

  @Post()
  @RequirePermissions('meetings.create')
  @ApiOperation({
    summary: 'Create an online meeting room with Google Meet link (UC-43)',
    description:
      'Requires meetings.create permission. Automatically generates a Google Meet link if customMeetingUrl is not provided.',
  })
  @ApiResponse({ status: 201, description: 'Meeting room created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input (title, time range, attendee email)' })
  @ApiResponse({ status: 403, description: 'Missing meetings.create permission' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMeetingDto,
  ) {
    return this.createMeetingService.execute(user.userId, user.email, {
      title: dto.title,
      description: dto.description,
      customMeetingUrl: dto.customMeetingUrl,
      projectId: dto.projectId,
      attendeeEmails: dto.attendeeEmails ?? [],
      scheduledStartTime: new Date(dto.scheduledStartTime),
      scheduledEndTime: new Date(dto.scheduledEndTime),
    });
  }

  @Get()
  @RequirePermissions('meetings.view')
  @ApiOperation({
    summary: 'List meeting rooms (UC-43)',
    description: 'Requires meetings.view permission.',
  })
  @ApiQuery({ name: 'status', required: false, enum: MeetingStatus })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Meeting list retrieved successfully' })
  async list(@Query() query: ListMeetingsQueryDto) {
    return this.listMeetingsService.execute({
      status: query.status as MeetingStatus | undefined,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('meetings.view')
  @ApiOperation({
    summary: 'Get meeting room details by ID',
    description: 'Retrieve complete meeting room information including agenda, link, and participants.',
  })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting details retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async getById(@Param('id') id: string) {
    return this.manageMeetingService.getById(id);
  }

  @Patch(':id')
  @RequirePermissions('meetings.create')
  @ApiOperation({
    summary: 'Update meeting room details',
    description: 'Modify title, agenda, schedule, attendees, or meeting link.',
  })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid update payload' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeetingDto,
  ) {
    return this.manageMeetingService.update(id, user.userId, dto);
  }

  @Patch(':id/status')
  @RequirePermissions('meetings.create')
  @ApiOperation({
    summary: 'Update meeting status',
    description: 'Transition meeting status to SCHEDULED, IN_PROGRESS, COMPLETED, or CANCELLED.',
  })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting status updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid status' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async updateStatus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeetingStatusDto,
  ) {
    return this.manageMeetingService.updateStatus(id, user.userId, dto.status);
  }

  @Delete(':id')
  @RequirePermissions('meetings.create')
  @ApiOperation({
    summary: 'Delete a meeting room',
    description: 'Permanently remove a meeting room from the system.',
  })
  @ApiParam({ name: 'id', description: 'Meeting ID' })
  @ApiResponse({ status: 200, description: 'Meeting deleted successfully' })
  @ApiResponse({ status: 404, description: 'Meeting not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.manageMeetingService.delete(id, user.userId);
  }
}
