import { Injectable, MessageEvent } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class NotificationsService {
  private readonly notificationSubject = new Subject<any>();

  emitNotification(type: string, payload: any) {
    this.notificationSubject.next({
      type,
      payload,
      timestamp: new Date().toISOString(),
    });
  }

  getNotificationStream(): Observable<MessageEvent> {
    return this.notificationSubject.asObservable().pipe(
      map((data) => ({
        data,
      } as MessageEvent)),
    );
  }
}
