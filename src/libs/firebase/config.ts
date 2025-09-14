// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics } from "firebase/analytics";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import type { FirebaseStorage } from "firebase/storage";
import { logger } from "../utils/logger";

// Define a type for our Firebase services
interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  storage: FirebaseStorage;
  analytics: Analytics | null;
}

// Create a variable to store initialized services
let firebaseServices: FirebaseServices | null = null;
let initializationPromise: Promise<FirebaseServices> | null = null;

async function initializeFirebase(): Promise<FirebaseServices> {
  // If services are already initialized, return them
  if (firebaseServices) return firebaseServices;
  
  // If initialization is in progress, return the existing promise
  if (initializationPromise) return initializationPromise;

  // Start new initialization
  initializationPromise = (async () => {
    try {
      logger.info('Starting Auking services...');
      const response = await fetch('/api/config');
      
      if (!response.ok) {
        logger.error(`Config API error: ${response.status} ${response.statusText}`);
        const text = await response.text();
        logger.error(`Error response: ${text}`);
        throw new Error(`Config API failed: ${response.status}`);
      }

      const firebaseConfig = await response.json();
      // logger.info(`Config received: ${JSON.stringify(firebaseConfig, null, 2)}`);

      if (!firebaseConfig || !firebaseConfig.apiKey) {
        logger.error(`Invalid config: ${JSON.stringify(firebaseConfig)}`);
        throw new Error('Invalid Firebase configuration');
      }

      const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
      
      firebaseServices = {
        app,
        auth: getAuth(app),
        db: getFirestore(app),
        storage: getStorage(app),
        analytics: typeof window !== 'undefined' ? getAnalytics(app) : null
      };

      logger.info('Auking services initialized successfully');
      return firebaseServices;
    } catch (error) {
      logger.error('Auking services initialization error:', error instanceof Error ? error : new Error(String(error)));
      initializationPromise = null; // Reset promise on error
      throw error;
    }
  })();

  return initializationPromise;
}

export { initializeFirebase }
export type { FirebaseServices }