import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'
import { sendEmail } from '@/app/api/auth/email-service'

export async function POST(request: Request) {
  try {
    const { email } = await request.json()
    
    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Store code in Firestore
    const db = await getDb()
    await db.collection('auth_codes').doc(email).set({
      code,
      expiresAt,
      attempts: 0,
      createdAt: new Date()
    })

    // Send email asynchronously (don't wait for it)
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">LexiLeap Verification Code</h2>
        <p>Your verification code is:</p>
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <span style="font-size: 32px; font-weight: bold; color: #1f2937; letter-spacing: 4px;">${code}</span>
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 14px;">LexiLeap - Your vocabulary learning companion</p>
      </div>
    `

    sendEmail(email, 'LexiLeap Verification Code', emailHtml).catch(error => {
      logger.error('Async email sending failed:', error instanceof Error ? error : new Error(String(error)))
    })

    logger.info('Verification code generated and email queued:', { email, codeLength: code.length })
    
    return NextResponse.json({ 
      success: true, 
      message: 'Verification code sent to your email' 
    })
  } catch (error) {
    logger.error('Send code error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to send verification code' }, { status: 500 })
  }
}

