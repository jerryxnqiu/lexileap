import { NextResponse } from 'next/server'
import { getDb } from '@/libs/firebase/admin'
import { logger } from '@/libs/utils/logger'

export async function POST(request: Request) {
  try {
    const { email, code } = await request.json()
    
    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }

    const db = await getDb()
    const codeDoc = await db.collection('auth_codes').doc(email).get()
    
    if (!codeDoc.exists) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
    }

    const codeData = codeDoc.data()
    if (!codeData) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
    }

    // Check if code has expired
    if (new Date() > codeData.expiresAt.toDate()) {
      await db.collection('auth_codes').doc(email).delete()
      return NextResponse.json({ error: 'Code has expired' }, { status: 400 })
    }

    // Check attempt limit
    if (codeData.attempts >= 3) {
      await db.collection('auth_codes').doc(email).delete()
      return NextResponse.json({ error: 'Too many attempts. Please request a new code.' }, { status: 400 })
    }

    // Verify code
    if (code !== codeData.code) {
      // Increment attempts
      await db.collection('auth_codes').doc(email).update({
        attempts: codeData.attempts + 1
      })
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Code is valid - clean up and create user session
    await db.collection('auth_codes').doc(email).delete()
    
    // Create or update user record
    const userRef = db.collection('users').doc(email)
    const userDoc = await userRef.get()
    
    let userData
    if (userDoc.exists) {
      userData = userDoc.data()!
    } else {
      userData = {
        email,
        createdAt: new Date(),
        lastLoginAt: new Date()
      }
      await userRef.set(userData)
    }

    // Update last login
    await userRef.update({ lastLoginAt: new Date() })

    logger.info('User authenticated successfully:', { email })
    
    return NextResponse.json({ 
      success: true,
      user: {
        email: userData.email,
        name: userData.name,
        createdAt: userData.createdAt
      }
    })
  } catch (error) {
    logger.error('Verify code error:', error instanceof Error ? error : new Error(String(error)))
    return NextResponse.json({ error: 'Failed to verify code' }, { status: 500 })
  }
}
