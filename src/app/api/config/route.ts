import { NextResponse } from 'next/server'
import { getSecret } from '@/libs/firebase/secret'
import { logger } from '@/libs/utils/logger';


export async function GET() {
  try {
    logger.info('Config API called');
    
    // Get all Firebase config values from Secret Manager
    const [
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
      measurementId
    ] = await Promise.all([
      getSecret('firebase-api-key'),
      getSecret('firebase-auth-domain'),
      getSecret('firebase-project-id'),
      getSecret('firebase-storage-bucket'),
      getSecret('firebase-messaging-sender-id'),
      getSecret('firebase-app-id'),
      getSecret('firebase-measurement-id')
    ]);

    const firebaseConfig = {
      apiKey,
      authDomain,
      projectId,
      storageBucket,
      messagingSenderId,
      appId,
      measurementId
    };

    // Validate config
    if (!firebaseConfig.apiKey) {
      logger.error('Firebase config incomplete');
      return NextResponse.json({ error: 'Invalid configuration' }, { status: 500 });
    }

    logger.info('Config available:', { apiKey: !!firebaseConfig.apiKey });
    return NextResponse.json(firebaseConfig);
  } catch (error) {
    logger.error('Config fetch error:', error as Error);
    return NextResponse.json({ error: 'Failed to fetch config' }, { status: 500 });
  }
} 