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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { PermissionsGuard } from '../../../shared/security/permissions.guard';
import { RequirePermissions } from '../../../shared/security/require-permissions.decorator';
import { ResourceTransferApprovalService } from '../application/resource-transfer-approval.service';
import {
  ApproveTransferRequestDto,
  CreateTransferRequestDto,
  RejectTransferRequestDto,
} from './resource-transfer-request.dto';
import { TransferRequestStatus } from '../domain/resource-transfer-request.types';

@ApiTags('Resource Transfer Approval (UC-88)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('resource-transfers')
export class ResourceTransferController {
  constructor(
    private readonly transferApprovalService: ResourceTransferApprovalService,
  ) {}

  @Post('requests')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Submit a new resource transfer request (UC-88 / UC-84)',
    description:
      'Creates a pending resource transfer request for a modernization project awaiting Team Lead approval.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Transfer request created successfully',
  })
  async createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransferRequestDto,
  ) {
    return this.transferApprovalService.createRequest(user.userId, dto);
  }

  @Get('requests')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'List resource transfer requests for Team Lead review (UC-88)',
    description:
      'Retrieves transfer requests accessible to the current Team Lead, with optional status and search filter.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of transfer requests retrieved successfully',
  })
  async listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: TransferRequestStatus,
    @Query('search') search?: string,
  ) {
    return this.transferApprovalService.listRequests(
      user.userId,
      user.isPlatformAdmin,
      { status, search },
    );
  }

  @Get('requests/:id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Get transfer request details & live validation (UC-88)',
    description:
      'Fetches authoritative details and pre-approval validation checks for a transfer request.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Transfer request details retrieved successfully',
  })
  async getRequestDetails(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.transferApprovalService.getRequestById(
      user.userId,
      id,
      user.isPlatformAdmin,
    );
  }

  @Post('requests/:id/approve')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Approve resource transfer request (UC-88)',
    description:
      'Team Lead explicitly approves the transfer request. Integrates with UC-84 to update resource assignment, writes audit log, and notifies successor.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resource transfer approved and assignment committed successfully',
  })
  async approveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveTransferRequestDto,
  ) {
    return this.transferApprovalService.approveRequest(user.userId, id, dto);
  }

  @Post('requests/:id/reject')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('teams.manage')
  @ApiOperation({
    summary: 'Reject resource transfer request (UC-88)',
    description:
      'Team Lead rejects the resource transfer request with a required explanation reason.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Resource transfer request rejected successfully',
  })
  async rejectRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectTransferRequestDto,
  ) {
    return this.transferApprovalService.rejectRequest(user.userId, id, dto);
  }
}
