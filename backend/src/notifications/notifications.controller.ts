import { Controller, Sse, type MessageEvent, UseGuards } from '@nestjs/common';
import { type Observable } from 'rxjs';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Sse('sse')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  getNotifications(): Observable<MessageEvent> {
    return this.notificationsService.getNotificationStream();
  }
}
