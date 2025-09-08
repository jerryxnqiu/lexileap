import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { logger } from '@/libs/utils/logger';

const secretManagerClient = new SecretManagerServiceClient()
const PROJECT_ID = 'business-dfb30'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

type CachedSecret = {
  value: string | null
  expiresAt: number
}

const secretCache = new Map<string, CachedSecret>()

export async function getSecret(secretName: string): Promise<string | null> {
  try {
    // Serve from cache when valid
    const cached = secretCache.get(secretName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    // Cache miss: fetch from Secret Manager
    logger.info(`Fetching from Secret Manager: ${secretName}`)
    const [version] = await secretManagerClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`,
    })
    const value = version.payload?.data?.toString() || null
    secretCache.set(secretName, { value, expiresAt: Date.now() + CACHE_TTL_MS })
    return value
  } catch (error) {
    logger.error(`Secret Manager error for ${secretName}:`, error as Error)
    return null
  }
}