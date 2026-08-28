import { Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(@Req() request: Request, @Query() query: ListNotificationsDto) {
    return this.notifications.list(request.user?.subject ?? '', query);
  }
  @Get('unread-count') unread(@Req() request: Request) {
    return this.notifications.unreadCount(request.user?.subject ?? '');
  }
  @Patch(':id/read') read(@Param('id') id: string, @Req() request: Request) {
    return this.notifications.markRead(id, request.user?.subject ?? '');
  }
}
