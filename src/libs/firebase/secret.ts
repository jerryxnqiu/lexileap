import { SecretManagerServiceClient } from '@google-cloud/secret-manager'
import { logger } from '@/libs/utils/logger';

const secretManagerClient = new SecretManagerServiceClient()
const PROJECT_ID = 'business-dfb30'

export async function getSecret(secretName: string): Promise<string | null> {
  try {
    // Try Secret Manager
    logger.info(`Fetching from Secret Manager: ${secretName}`)
    const [version] = await secretManagerClient.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`,
    })
    return version.payload?.data?.toString() || null
  } catch (error) {
    logger.error(`Secret Manager error for ${secretName}:`, error as Error)
    return null
  }
}