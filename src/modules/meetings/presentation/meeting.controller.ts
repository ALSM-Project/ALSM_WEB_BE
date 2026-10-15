import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { CreateMeetingService } from '../application/create-meeting.service';
import { ListMeetingsService } from '../application/list-meetings.service';
import { CreateMeetingDto, ListMeetingsQueryDto } from './meeting.dto';
import { MeetingStatus } from '../domain/meeting.types';

@ApiTags('Meetings (UC-43)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('meetings')
export class MeetingController {
  constructor(
    private readonly createMeetingService: CreateMeetingService,
    private readonly listMeetingsService: ListMeetingsService,
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
}
