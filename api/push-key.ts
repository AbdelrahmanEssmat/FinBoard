/**
 * Vercel function: GET /api/push-key → the public key a device needs to turn reminders on.
 *
 * The app passes it to pushManager.subscribe() as the applicationServerKey. It is the public half of
 * the server's VAPID key pair, so it is safe to hand out.
 *
 * Response: { publicKey }, or 501 { error: 'not_configured' } until scripts/configure-push.ps1 has
 * been run (see docs/reminders.md).
 */
import { handlePushKey } from '../src/server/push.js'

export async function GET(): Promise<Response> {
  return handlePushKey({ env: process.env })
}
