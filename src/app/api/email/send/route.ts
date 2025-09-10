import { NextResponse } from 'next/server'
import { logger } from '@/libs/utils/logger'
import { sendEmail } from '@/app/api/auth/email-service'

export async function POST(request: Request) {
  try {
    const { to, subject, html } = await request.json()
    
    if (!to || !subject || !html) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const success = await sendEmail(to, subject, html)
    
    if (success) {
      return NextResponse.json({ success: true })
    } else {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }
  } catch (error) {
    logger.error('Email service error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
