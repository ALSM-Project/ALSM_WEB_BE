import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../shared/security/jwt-auth.guard';
import { CurrentUser } from '../../../../shared/security/current-user.decorator';
import { AuthenticatedUser } from '../../../../shared/logging/request-id.middleware';
import { CommandPaletteService } from '../../application/services/command-palette.service';
import { MenuPresenter } from '../response/menu.presenter';

@ApiTags('Command Palette')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('commands')
export class CommandPaletteController {
  constructor(
    private readonly commandPaletteService: CommandPaletteService,
  ) {}

  @Get('search')
  @ApiOperation({ summary: 'Search commands for Command Palette (Ctrl+K)' })
  async searchCommands(
    @Query('q') query: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const role = (user as any).role || 'user';
    const commands = await this.commandPaletteService.searchCommands(
      query || '',
      user.userId,
      role,
    );

    return MenuPresenter.toCommandResponse(commands, query);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all available commands' })
  async getAllCommands(
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const role = (user as any).role || 'user';
    const commands = await this.commandPaletteService.getCommands(
      user.userId,
      role,
    );

    return MenuPresenter.toCommandResponse(commands);
  }
}
