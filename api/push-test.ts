/**
 * Vercel function: POST /api/push-test → sends a sample reminder to the signed-in person's devices.
 *
 * Request: header "Authorization: Bearer <the person's Supabase access token>" and an optional JSON
 * body { endpoint } to send only to that device (the one the person is holding).
 *
 * Response: { sent } (how many devices accepted it), 401 without a valid sign-in, 501
 * { error: 'not_configured', message } until reminders are set up on the server
 * (scripts/configure-push.ps1, see docs/reminders.md).
 */
import webpush from 'web-push'
import { handlePushTest } from '../src/server/push.js'

export async function POST(request: Request): Promise<Response> {
  return handlePushTest(request, { env: process.env, webpush })
}
