import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import dayjs from 'dayjs';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Warns before a channel's connection runs out, instead of the first anyone
// hears of it being a failed post (October 2026: a personal LinkedIn profile
// expired and the post failed before anything said so). Two cases:
//
//  - A connection that can't renew itself (no renewal token): its access
//    token's expiry is the end. Personal LinkedIn profiles connected through
//    the basic app were like this, every 60 days.
//  - A LinkedIn renewal token near its own end. They last a year from when the
//    channel was connected; after that even company pages need reconnecting.
//
// Each warning goes out once per threshold, in the app and by email, to the
// channel's workspace. Already-disconnected channels are left alone: they were
// told at the moment they broke (informAboutRefreshError).

const EVERY_HOURS = 6;
const ACCESS_WARN_DAYS = [7, 1];
const RENEWAL_WARN_DAYS = [14, 3];
const DAY = 24 * 60 * 60 * 1000;

type Channel = Awaited<ReturnType<IntegrationRepository['channelsForExpiryCheck']>>[number];

/** Which warning is due, if any: the tightest threshold already reached, or
 *  "expired" once the end has passed. */
export function dueWarning(end: Date, now: Date, thresholds: number[]): number | 'expired' | null {
  const daysLeft = (end.getTime() - now.getTime()) / DAY;
  if (daysLeft <= 0) return 'expired';
  const reached = thresholds.filter((t) => daysLeft <= t);
  return reached.length ? Math.min(...reached) : null;
}

const PROVIDER_NAMES: Record<string, string> = {
  linkedin: 'LinkedIn',
  'linkedin-page': 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  'instagram-standalone': 'Instagram',
  x: 'X',
  threads: 'Threads',
  tiktok: 'TikTok',
  youtube: 'YouTube',
};

@Injectable()
export class ChannelExpiryService implements OnModuleInit {
  constructor(
    private _integrations: IntegrationRepository,
    private _notifications: NotificationService
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_CHANNEL_EXPIRY_CHECK === 'true') return;
    const run = () => this.check().catch((e) => console.error('Channel expiry check failed:', e));
    // Two minutes after start (once Temporal and Redis are settled), then every few hours.
    setTimeout(run, 2 * 60 * 1000).unref();
    setInterval(run, EVERY_HOURS * 60 * 60 * 1000).unref();
  }

  async check(now = new Date()) {
    const channels = await this._integrations.channelsForExpiryCheck();
    const upcoming: string[] = [];

    for (const c of channels) {
      if (!c.refreshToken && c.tokenExpiration) {
        upcoming.push(this.describe(c, c.tokenExpiration, now));
        await this.warnIfDue(c, c.tokenExpiration, ACCESS_WARN_DAYS, 'access', now);
      }
      if (c.refreshToken && c.providerIdentifier.startsWith('linkedin')) {
        const end = await this.linkedinRenewalEnd(c.refreshToken);
        if (end) {
          upcoming.push(this.describe(c, end, now, 'renewal'));
          await this.warnIfDue(c, end, RENEWAL_WARN_DAYS, 'renewal', now);
        }
      }
    }

    const soon = upcoming.filter(Boolean);
    console.log(`Channel expiry check: ${channels.length} channels${soon.length ? `; within 30 days: ${soon.join('; ')}` : ', nothing within 30 days'}.`);
  }

  private label(c: Channel) {
    return `${PROVIDER_NAMES[c.providerIdentifier] || c.providerIdentifier} (${c.name})`;
  }

  private describe(c: Channel, end: Date, now: Date, kind: 'access' | 'renewal' = 'access') {
    const days = Math.ceil((end.getTime() - now.getTime()) / DAY);
    if (days > 30) return '';
    return `${this.label(c)} ${kind === 'renewal' ? 'renewal ends' : 'expires'} ${dayjs(end).format('YYYY-MM-DD')} (${days}d)`;
  }

  private async warnIfDue(
    c: Channel,
    end: Date,
    thresholds: number[],
    kind: 'access' | 'renewal',
    now: Date
  ) {
    const due = dueWarning(end, now, thresholds);
    if (due === null) return;

    // Once per channel, kind, end date and threshold: a reconnect moves the end
    // date, so the next cycle warns afresh.
    const key = `channel-expiry:${c.id}:${kind}:${dayjs(end).format('YYYY-MM-DD')}:${due}`;
    const claimed = await ioRedis.set(key, '1', 'EX', 60 * 60 * 24 * 60, 'NX');
    if (!claimed) return;

    const label = this.label(c);
    const when = dayjs(end).format('D MMM YYYY');
    const link = `${process.env.FRONTEND_URL}/launches`;
    const how = `In Datafly Social, open the channel's ⋮ menu and choose Reconnect channel: ${link}`;

    const [subject, message] =
      due === 'expired'
        ? [
            `${label} has disconnected`,
            `Your ${label} connection has expired, so posts to it will fail. ${how}`,
          ]
        : kind === 'access'
          ? [
              `Reconnect ${label} before ${when}`,
              `Your ${label} connection expires on ${when}. After that, posts to it will fail. ${how}`,
            ]
          : [
              `Reconnect ${label} before ${when}`,
              `Your ${label} connection renews itself until ${when}, a year after it was connected. Reconnect it before then and it renews for another year. ${how}`,
            ];

    await this._notifications.inAppNotification(c.organizationId, subject, message, true, false, 'info');
    console.log(`Channel expiry: warned about ${label} (${kind}, ${due === 'expired' ? 'expired' : `${due} days`}).`);
  }

  /** When a LinkedIn renewal token stops working, from LinkedIn itself.
   *  Cached a day, keyed on a hash so no token goes into Redis. */
  private async linkedinRenewalEnd(refreshToken: string): Promise<Date | null> {
    const cacheKey = `linkedin-renewal-end:${createHash('sha256').update(refreshToken).digest('hex').slice(0, 32)}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) return cached === 'unknown' ? null : new Date(cached);

    // Only the approved app issues renewal tokens, so it's the one to ask.
    const clientId = process.env.LINKEDIN_PAGE_CLIENT_ID || process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_PAGE_CLIENT_SECRET || process.env.LINKEDIN_CLIENT_SECRET;
    let end: Date | null = null;
    try {
      const res = await fetch('https://www.linkedin.com/oauth/v2/introspectToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, token: refreshToken }),
      });
      const j = await res.json();
      if (j?.active && j?.expires_at) end = new Date(j.expires_at * 1000);
    } catch {
      // LinkedIn unreachable: try again next run.
      return null;
    }
    await ioRedis.set(cacheKey, end ? end.toISOString() : 'unknown', 'EX', 60 * 60 * 24);
    return end;
  }
}
