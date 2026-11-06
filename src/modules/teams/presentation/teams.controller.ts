import { CurrentSessionGuard } from '../../../shared/security/current-session.guard';
import { Body, Controller, Get, Headers, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../shared/security/current-user.decorator';
import { JwtAuthGuard } from '../../../shared/security/jwt-auth.guard';
import { AuthenticatedUser } from '../../../shared/logging/request-id.middleware';
import { SaveTeamService } from '../application/save-team.service';
import { ListManagedTeamsService } from '../application/list-managed-teams.service';
import {
  AddExistingSalesTeamMembersDto,
  SalesTeamMemberSearchQuery,
  SaveTeamDto,
  TeamKindQuery,
} from './team.dto';
import { GetTeamAdministrationService } from '../application/get-team-administration.service';
import { ListOrganizationTeamMembersService } from '../application/list-organization-team-members.service';
import { SearchSalesTeamMemberCandidatesService } from '../application/search-sales-team-member-candidates.service';
import { AddExistingSalesTeamMembersService } from '../application/add-existing-sales-team-members.service';

@ApiTags('Teams')
@ApiBearerAuth()
@ApiHeader({ name: 'x-organization-id', required: false })
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('teams')
export class TeamsController {
  constructor(
    private readonly save: SaveTeamService,
    private readonly list: ListManagedTeamsService,
    private readonly administration: GetTeamAdministrationService,
    private readonly organizationMembers: ListOrganizationTeamMembersService,
    private readonly memberCandidates: SearchSalesTeamMemberCandidatesService,
    private readonly addSalesMembers: AddExistingSalesTeamMembersService,
  ) {}
  @Get('members')
  @ApiOperation({
    summary: 'List active members of the current organization; requires organization OWNER/ADMIN and users.manage',
  })
  listOrganizationMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
  ) {
    return this.organizationMembers.execute(user.userId, organizationId);
  }
  @Get('members/candidates')
  @ApiOperation({
    summary: 'Search active internal Sales accounts that can be added to the current organization',
  })
  searchSalesMemberCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: SalesTeamMemberSearchQuery,
  ) {
    return this.memberCandidates.execute(user.userId, organizationId, query.q);
  }
  @Post('members')
  @ApiOperation({
    summary: 'Add existing internal Sales accounts to the current organization as members',
  })
  addExistingSalesMembers(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() input: AddExistingSalesTeamMembersDto,
  ) {
    return this.addSalesMembers.execute(user.userId, organizationId, input.userIds);
  }
  @Get(':teamId/administration')
  @ApiOperation({
    summary:
      'Read the current revision and assignments; requires organization OWNER/ADMIN and users.manage',
  })
  getAdministration(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') id: string,
  ) {
    return this.administration.execute(user.userId, organizationId, id);
  }
  @Get()
  @ApiOperation({
    summary: 'List only teams explicitly managed by the current active organization member',
  })
  listTeams(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Query() query: TeamKindQuery,
  ) {
    return this.list.execute(user.userId, organizationId, query.kind);
  }
  @Post()
  @ApiOperation({
    summary:
      'Create a team; requires organization OWNER/ADMIN plus existing users.manage permission',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() input: SaveTeamDto,
  ) {
    return this.save.execute(user.userId, organizationId, input);
  }
  @Put(':teamId')
  @ApiOperation({
    summary:
      'Replace explicit membership, manager and project assignments using the exact revision; type is immutable',
  })
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Param('teamId') id: string,
    @Body() input: SaveTeamDto,
  ) {
    return this.save.execute(user.userId, organizationId, input, id);
  }
}
