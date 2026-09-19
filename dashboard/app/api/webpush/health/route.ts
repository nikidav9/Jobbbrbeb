import { NextResponse } from 'next/server'

export async function GET() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || ''
  const privateKey = process.env.VAPID_PRIVATE_KEY || ''
  const subject = process.env.VAPID_SUBJECT || 'mailto:nikidav9@gmail.com'

  return NextResponse.json({
    ok: Boolean(publicKey && privateKey),
    publicKey,
    privateConfigured: Boolean(privateKey),
    subject,
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
