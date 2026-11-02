import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { UserOffboardingApprovalService } from '../application/user-offboarding-approval.service';
import {
  ApproveOffboardingRequestDto,
  CreateOffboardingRequestDto,
  ListOffboardingRequestsQueryDto,
  CancelOffboardingRequestDto,
  RejectOffboardingRequestDto,
} from './offboarding-request.dto';

@ApiTags('User Offboarding Approvals (UC-89)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('offboarding-requests')
export class OffboardingApprovalController {
  constructor(
    private readonly approvalService: UserOffboardingApprovalService,
  ) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Submit a new user offboarding request (UC-89)',
    description:
      'Creates a pending user offboarding request awaiting Team Lead or Admin approval.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Offboarding request created successfully',
  })
  async createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOffboardingRequestDto,
  ) {
    return this.approvalService.createRequest(
      user.userId,
      dto,
      user.isPlatformAdmin,
    );
  }

  @Get()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'List offboarding requests (UC-89)',
    description:
      'Retrieves offboarding requests scoped to the authenticated Team Lead or all requests for Platform Admin.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of offboarding requests retrieved successfully',
  })
  async listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListOffboardingRequestsQueryDto,
  ) {
    return this.approvalService.listRequests(
      user.userId,
      user.isPlatformAdmin,
      query,
    );
  }


  @Get('search-staff')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Search staff members for offboarding with autocomplete',
    description: 'Searches staff by name, email, or employee ID (query >= 2 characters).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Matching staff members retrieved successfully',
  })
  async searchStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') query?: string,
  ) {
    return this.approvalService.searchStaff(
      user.userId,
      query || '',
      user.isPlatformAdmin,
    );
  }

  @Get(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Get offboarding request details and live impact summary (UC-89)',
    description:
      'Returns complete offboarding request dossier with live UC-83 resource impact review.',
  })
  @ApiParam({ name: 'id', description: 'Offboarding request ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Offboarding request details retrieved successfully',
  })
  async getRequestDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.approvalService.getRequestDetails(
      user.userId,
      id,
      user.isPlatformAdmin,
    );
  }

  @Post(':id/approve')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Approve user offboarding request (UC-89)',
    description:
      'Approves request, executes controlled offboarding workflow (UC-83), revokes sessions/credentials, transfers resources, and deactivates account.',
  })
  @ApiParam({ name: 'id', description: 'Offboarding request ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Offboarding request approved and executed successfully',
  })
  async approveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveOffboardingRequestDto,
  ) {
    return this.approvalService.approveRequest(
      user.userId,
      id,
      dto,
      user.isPlatformAdmin,
    );
  }

  @Post(':id/reject')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Reject user offboarding request (UC-89)',
    description:
      'Rejects pending offboarding request with mandatory rejection reason without modifying user account or resources.',
  })
  @ApiParam({ name: 'id', description: 'Offboarding request ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Offboarding request rejected successfully',
  })
  async rejectRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectOffboardingRequestDto,
  ) {
    return this.approvalService.rejectRequest(
      user.userId,
      id,
      dto,
      user.isPlatformAdmin,
    );
  }


  @Post(':id/cancel')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('users.offboard')
  @ApiOperation({
    summary: 'Cancel user offboarding request',
    description: 'Allows the requester or an administrator to cancel a pending or draft offboarding request.',
  })
  @ApiParam({ name: 'id', description: 'Offboarding request ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Offboarding request cancelled successfully',
  })
  async cancelRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelOffboardingRequestDto,
  ) {
    return this.approvalService.cancelRequest(
      user.userId,
      id,
      dto?.reason,
      user.isPlatformAdmin,
    );
  }
}
