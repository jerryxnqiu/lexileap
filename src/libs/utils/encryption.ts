import { getSecret } from '@/libs/firebase/secret'
import crypto from 'crypto'

// Encryption/Decryption utilities for session IDs
// Uses AES-256-GCM for authenticated encryption

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // 128 bits
const SALT_LENGTH = 64
const TAG_LENGTH = 16
const KEY_LENGTH = 32

async function getEncryptionKey(): Promise<Buffer> {
  // Use existing secret from Secret Manager for encryption key
  // Combine multiple secrets for better security
  const [deepseekKey, dataUrl] = await Promise.all([
    getSecret('lexileap-deepseek-api-key'),
    getSecret('lexileap-data-url')
  ])
  
  if (!deepseekKey && !dataUrl) {
    throw new Error('Encryption key not available: missing secrets from Secret Manager')
  }
  
  // Use a combination if both are available for better security, otherwise use single secret
  const combinedKey = deepseekKey && dataUrl 
    ? `${deepseekKey}:${dataUrl}:quiz-session-encryption`
    : (deepseekKey || dataUrl || '')
  
  return crypto.createHash('sha256').update(combinedKey).digest()
}

export async function encryptSessionId(sessionId: string): Promise<string> {
  try {
    const key = await getEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    
    let encrypted = cipher.update(sessionId, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    
    const tag = cipher.getAuthTag()
    
    // Combine iv + tag + encrypted data
    const combined = iv.toString('hex') + tag.toString('hex') + encrypted
    
    // Base64 encode for URL safety
    return Buffer.from(combined, 'hex').toString('base64url')
  } catch (error) {
    throw new Error('Failed to encrypt session ID')
  }
}

export async function decryptSessionId(encrypted: string): Promise<string> {
  try {
    const key = await getEncryptionKey()
    
    // Decode from base64url
    const combined: string = Buffer.from(encrypted, 'base64url').toString('hex')
    
    // Extract iv, tag, and encrypted data
    const iv = Buffer.from(combined.substring(0, IV_LENGTH * 2), 'hex')
    const tag = Buffer.from(combined.substring(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2), 'hex')
    const encryptedData: string = combined.substring(IV_LENGTH * 2 + TAG_LENGTH * 2)
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    
    return decrypted
  } catch (error) {
    throw new Error('Failed to decrypt session ID')
  }
}
