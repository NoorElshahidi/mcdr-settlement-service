import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { DomainException } from '../common/exceptions/app.exceptions';
import { ListNotificationsDto } from './dto/list-notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async list(subject: string, query: ListNotificationsDto = new ListNotificationsDto()) {
    const limit = query.limit ?? 50;
    const user = await this.users.findOne({ where: { keycloakSubject: subject }, select: ['id'] });
    if (!user) return { items: [], nextCursor: null, limit };
    const builder = this.notifications
      .createQueryBuilder('notification')
      .select([
        'notification.id AS id',
        'notification.type AS type',
        'notification.title AS title',
        'notification.body AS body',
        'notification.request_id AS requestId',
        'notification.read_at AS readAt',
        'notification.created_at AS createdAt',
      ])
      .where('notification.recipient_id = :recipientId', { recipientId: user.id })
      .orderBy('notification.created_at', 'DESC')
      .addOrderBy('notification.id', 'DESC')
      .limit(limit + 1);
    if (query.cursor) {
      const [cursorDate, cursorId] = this.decodeCursor(query.cursor);
      builder.andWhere(
        '(notification.created_at < :cursorDate OR (notification.created_at = :cursorDate AND notification.id < :cursorId))',
        { cursorDate, cursorId },
      );
    }
    const rows = await builder.getRawMany<Record<string, unknown>>();
    const hasNext = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasNext && last ? this.encodeCursor(String(last.createdAt), String(last.id)) : null,
      limit,
    };
  }

  private encodeCursor(date: string, id: string): string {
    return Buffer.from(`${new Date(date).toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): [string, string] {
    const [date, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!date || !id || Number.isNaN(Date.parse(date)))
      throw new DomainException('INVALID_CURSOR', 'The pagination cursor is invalid.');
    return [new Date(date).toISOString(), id];
  }

  async markRead(id: string, subject: string) {
    const user = await this.users.findOne({ where: { keycloakSubject: subject }, select: ['id'] });
    const notification = user
      ? await this.notifications.findOne({ where: { id, recipientId: user.id } })
      : null;
    if (!notification)
      throw new DomainException(
        'NOTIFICATION_NOT_FOUND',
        'Notification was not found.',
        HttpStatus.NOT_FOUND,
      );
    notification.readAt = new Date();
    return this.notifications.save(notification);
  }

  async unreadCount(subject: string): Promise<number> {
    const user = await this.users.findOne({ where: { keycloakSubject: subject }, select: ['id'] });
    return user
      ? this.notifications.count({ where: { recipientId: user.id, readAt: IsNull() } })
      : 0;
  }
}
