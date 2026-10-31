import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../../shared/logging/request-id.middleware';
import { CurrentUser } from '../../shared/security/current-user.decorator';
import { CurrentSessionGuard } from '../../shared/security/current-session.guard';
import { JwtAuthGuard } from '../../shared/security/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CurrentSessionGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the signed-in user' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listForUser(user.userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications for the signed-in user as read' })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.userId, id);
  }
}
