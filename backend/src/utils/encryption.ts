import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const KEY_FILE = path.join(DATA_DIR, '.encryption_key');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Encryption key management
let encryptionKey: Buffer | null = null;

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function getOrCreateEncryptionKey(): Promise<Buffer> {
  if (encryptionKey) {
    return encryptionKey;
  }

  await ensureDataDir();

  try {
    const keyData = await fs.readFile(KEY_FILE);
    encryptionKey = keyData;
    return encryptionKey;
  } catch {
    // Generate new key if none exists
    encryptionKey = crypto.randomBytes(32);
    await fs.writeFile(KEY_FILE, encryptionKey, { mode: 0o600 });
    console.log('Generated new encryption key for credential storage');
    return encryptionKey;
  }
}

/**
 * Encrypt a string value using AES-256-GCM
 * Returns base64 encoded string: salt:iv:authTag:ciphertext
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getOrCreateEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Derive a key from the master key using salt (provides additional security)
  const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Combine salt, iv, authTag, and ciphertext
  const combined = Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, 'base64')]);

  return combined.toString('base64');
}

/**
 * Decrypt a string value encrypted with encrypt()
 */
export async function decrypt(encryptedData: string): Promise<string> {
  const key = await getOrCreateEncryptionKey();
  const combined = Buffer.from(encryptedData, 'base64');

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  // Derive the key using the same salt
  const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');

  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext.toString('base64'), 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a value appears to be encrypted (base64 with expected length)
 */
export function isEncrypted(value: string): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    // Minimum length: salt (32) + iv (16) + authTag (16) + at least 1 byte of ciphertext
    return decoded.length >= SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
  } catch {
    return false;
  }
}

/**
 * Encrypt sensitive fields in an object
 */
export async function encryptSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  sensitiveFields: string[]
): Promise<T> {
  const result = { ...obj };

  for (const field of sensitiveFields) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      (result as Record<string, unknown>)[field] = await encrypt(value);
    }
  }

  return result;
}

/**
 * Decrypt sensitive fields in an object
 */
export async function decryptSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  sensitiveFields: string[]
): Promise<T> {
  const result = { ...obj };

  for (const field of sensitiveFields) {
    const value = result[field];
    if (typeof value === 'string' && isEncrypted(value)) {
      try {
        (result as Record<string, unknown>)[field] = await decrypt(value);
      } catch (error) {
        console.error(`Failed to decrypt field ${field}:`, error);
        // Leave the value as-is if decryption fails (might be plaintext from old format)
      }
    }
  }

  return result;
}

// ============ Backup Encryption ============

/**
 * Encrypt a file for backup storage
 * Returns the encrypted buffer with header containing IV
 */
export async function encryptBuffer(data: Buffer, passphrase?: string): Promise<Buffer> {
  const key = passphrase
    ? crypto.scryptSync(passphrase, 'dispatcharr-backup-salt', 32)
    : await getOrCreateEncryptionKey();

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: DBAK (4 bytes magic) + version (1 byte) + iv (16 bytes) + authTag (16 bytes) + ciphertext
  const header = Buffer.from('DBAK');
  const version = Buffer.from([1]);

  return Buffer.concat([header, version, iv, authTag, encrypted]);
}

/**
 * Decrypt a file from backup storage
 */
export async function decryptBuffer(encryptedData: Buffer, passphrase?: string): Promise<Buffer> {
  // Verify magic header
  const magic = encryptedData.subarray(0, 4).toString();
  if (magic !== 'DBAK') {
    throw new Error('Invalid encrypted backup format');
  }

  const version = encryptedData[4];
  if (version !== 1) {
    throw new Error(`Unsupported backup encryption version: ${version}`);
  }

  const key = passphrase
    ? crypto.scryptSync(passphrase, 'dispatcharr-backup-salt', 32)
    : await getOrCreateEncryptionKey();

  const iv = encryptedData.subarray(5, 5 + IV_LENGTH);
  const authTag = encryptedData.subarray(5 + IV_LENGTH, 5 + IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = encryptedData.subarray(5 + IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Check if a buffer is an encrypted backup
 */
export function isEncryptedBackup(data: Buffer): boolean {
  if (data.length < 5) return false;
  return data.subarray(0, 4).toString() === 'DBAK';
}
