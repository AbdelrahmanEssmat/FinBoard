/**
 * Vercel function: GET /api/reminders → sends today's reminders to everyone's devices.
 *
 * Vercel Cron calls it once a day (vercel.json "crons": 06:00 UTC, which is 08:00-09:00 in Cairo; on
 * the Hobby plan Vercel may run it any time within that hour). Vercel sends
 * "Authorization: Bearer <CRON_SECRET>"; any other caller gets 401. Running it twice is harmless:
 * reminders are marked sent and never sent again, and a missed day is caught up on the next run.
 *
 * Response: { users, reminders, notifications, removedSubscriptions, errors }, or 501 until reminders
 * are set up on the server (scripts/configure-push.ps1, see docs/reminders.md).
 */
import webpush from 'web-push'
import { handleReminders } from '../src/server/push.js'

export const config = { maxDuration: 60 }

export async function GET(request: Request): Promise<Response> {
  return handleReminders(request, { env: process.env, webpush })
}
