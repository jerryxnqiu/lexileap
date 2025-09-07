import admin from 'firebase-admin'
import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { logger } from '@/libs/utils/logger'

async function getServiceAccount() {
  const client = new SecretManagerServiceClient()
  const name = 'projects/business-dfb30/secrets/business-dfb30-firebase-adminsdk/versions/latest'
  
  const [version] = await client.accessSecretVersion({ name })
  if (!version.payload?.data) {
    throw new Error('No service account data found in Secret Manager')
  }
  
  const payload = version.payload.data.toString()
  return JSON.parse(payload)
}

// Initialize Firebase Admin once
let adminInitialized = false
async function initializeAdminApp() {
  if (!adminInitialized && !admin.apps.length) {
    try {
      const serviceAccount = await getServiceAccount()
      
      logger.info('Initializing Firebase Admin with project:', serviceAccount.project_id)
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'business-dfb30.firebasestorage.app'
      })
      adminInitialized = true
      logger.info('Firebase Admin initialized successfully')
    } catch (error) {
      logger.error('Error initializing admin app:', error as Error)
      throw error
    }
  }
  return admin
}

// Start initialization immediately
const initPromise = initializeAdminApp()

// Export initialized services
export const getDb = async () => {
  const adminApp = await initPromise
  return adminApp.firestore()
}

export const getAuth = async () => {
  const adminApp = await initPromise
  return adminApp.auth()
}

export const getStorage = async () => {
  const adminApp = await initPromise
  return adminApp.storage()
}

// Also export the promise for direct access if needed
export const adminPromise = initPromise