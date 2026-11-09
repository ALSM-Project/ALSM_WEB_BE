import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { OrganizationContextService } from '../../organizations/application/organization-context.service';
import { DeliverableService } from '../application/deliverable.service';
import {
  CreateDeliverableCandidateDto,
  ReviewDeliverableDto,
  TeamLeadReviewDeliverableDto,
} from './deliverable.dto';

const INTERNAL_ROLES = [
  'ADMIN',
  'PLATFORM_ADMIN',
  'TEAM_LEAD',
  'STAFF',
  'CONVERSION_STAFF',
  'ENGINEER',
  'SUPPORT',
];

@ApiTags('Deliverables')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-organization-id',
  required: false,
  description: 'Optional organization context',
})
@UseGuards(JwtAuthGuard)
@Controller('deliverables')
export class DeliverablesController {
  constructor(
    private readonly deliverables: DeliverableService,
    private readonly orgContext: OrganizationContextService,
  ) {}

  private isInternal(user: AuthenticatedUser): boolean {
    if (user.isPlatformAdmin) return true;
    return (
      user.roles?.some((r: string) => INTERNAL_ROLES.includes(r.toUpperCase())) ?? false
    );
  }

  @Get()
  @ApiOperation({
    summary:
      'List deliverables (Web3 customer gets published only; Web2 staff gets all)',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filter deliverables by project',
  })
  @ApiResponse({ status: 200, description: 'List of deliverables' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader?: string,
    @Query('projectId') projectId?: string,
  ) {
    const internal = this.isInternal(user);
    let orgId = '';
    try {
      const org = await this.orgContext.resolve(user.userId, organizationHeader);
      orgId = org.id;
    } catch {
      // If resolving org fails for internal staff, allow listing by projectId
      orgId = '';
    }
    return this.deliverables.listForOrganization(orgId, projectId, internal);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific deliverable' })
  @ApiParam({ name: 'id', description: 'Deliverable ID' })
  @ApiResponse({ status: 200, description: 'Deliverable details' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader?: string,
  ) {
    const internal = this.isInternal(user);
    let orgId = '';
    try {
      const org = await this.orgContext.resolve(user.userId, organizationHeader);
      orgId = org.id;
    } catch {
      orgId = '';
    }
    return this.deliverables.getById(id, orgId, internal);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Upload/Create a deliverable candidate (Staff or Lead)' })
  @ApiResponse({ status: 201, description: 'Deliverable candidate registered' })
  async createCandidate(
    @Body() dto: CreateDeliverableCandidateDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader?: string,
  ) {
    let orgId = '';
    try {
      const org = await this.orgContext.resolve(user.userId, organizationHeader);
      orgId = org.id;
    } catch {
      orgId = '66d99ec12871af85557f89b1'; // Fallback default
    }
    return this.deliverables.createCandidate(dto, user, orgId);
  }

  @Post(':id/team-lead-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Team Lead review candidate (Approve or Request Revision)' })
  @ApiParam({ name: 'id', description: 'Deliverable ID' })
  @ApiResponse({ status: 200, description: 'Deliverable reviewed by Team Lead' })
  async teamLeadReview(
    @Param('id') id: string,
    @Body() dto: TeamLeadReviewDeliverableDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.teamLeadReview(
      id,
      user,
      dto.decision,
      dto.notes,
    );
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin/Team Lead publishes approved deliverable to Web3 Customer' })
  @ApiParam({ name: 'id', description: 'Deliverable ID' })
  @ApiResponse({ status: 200, description: 'Deliverable officially published to customer' })
  async publish(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.deliverables.publish(id, user);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit customer review (Approve or Request Revision)' })
  @ApiParam({ name: 'id', description: 'Deliverable ID' })
  @ApiResponse({ status: 200, description: 'Updated deliverable with customer review' })
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewDeliverableDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationHeader?: string,
  ) {
    const org = await this.orgContext.resolve(user.userId, organizationHeader);
    return this.deliverables.reviewDeliverable(
      id,
      org.id,
      user,
      dto.decision,
      dto.feedbackNotes,
    );
  }
}
