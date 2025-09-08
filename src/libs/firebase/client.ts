import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { logger } from '@/libs/utils/logger';


let app: ReturnType<typeof initializeApp> | null = null
let auth: ReturnType<typeof getAuth> | null = null
let db: ReturnType<typeof getFirestore> | null = null
let storage: ReturnType<typeof getStorage> | null = null
let initializing = false
let initialized = false

async function initializeFirebase() {
  if (initialized) return { app: app!, auth: auth!, db: db!, storage: storage! }
  if (initializing) {
    // Wait for initialization to complete
    await new Promise(resolve => {
      const checkInitialized = () => {
        if (initialized) {
          resolve(true)
        } else {
          setTimeout(checkInitialized, 100)
        }
      }
      checkInitialized()
    })
    return { app: app!, auth: auth!, db: db!, storage: storage! }
  }

  initializing = true
  try {
    // Fetch config from your API endpoint
    const response = await fetch('/api/config')
    const config = await response.json()

    app = initializeApp(config)
    auth = getAuth(app)
    db = getFirestore(app)
    storage = getStorage(app)

    initialized = true
    initializing = false
    logger.info('Firebase client initialized successfully')
    return { app, auth, db, storage }
  } catch (error) {
    logger.error('Firebase initialization error:', error as Error)
    initializing = false
    throw error
  }
}

// Initialize Firebase on the client side
if (typeof window !== 'undefined') {
  initializeFirebase()
}

// Export getters that ensure initialization
export async function getFirebaseAuth() {
  if (!initialized) {
    await initializeFirebase()
  }
  if (!auth) throw new Error('Firebase Auth not initialized')
  return auth
}

export async function getFirebaseDb() {
  if (!initialized) {
    await initializeFirebase()
  }
  if (!db) throw new Error('Firebase Firestore not initialized')
  return db
}

export async function getFirebaseApp() {
  if (!initialized) {
    await initializeFirebase()
  }
  if (!app) throw new Error('Firebase App not initialized')
  return app
}

export async function getFirebaseStorage() {
  if (!initialized) {
    await initializeFirebase()
  }
  if (!storage) throw new Error('Firebase Storage not initialized')
  return storage
}

const firebaseClient = {
  initialize: initializeFirebase,
  getAuth: getFirebaseAuth,
  getDb: getFirebaseDb,
  getApp: getFirebaseApp,
  getStorage: getFirebaseStorage
}

export default firebaseClient