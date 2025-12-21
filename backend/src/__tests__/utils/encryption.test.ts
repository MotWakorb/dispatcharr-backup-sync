import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptSensitiveFields,
  decryptSensitiveFields,
  encryptBuffer,
  decryptBuffer,
  isEncryptedBackup,
} from '../../utils/encryption.js';

const TEST_DATA_DIR = '/tmp/dispatcharr-encryption-test-' + process.pid;

beforeEach(() => {
  // Create test data directory
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
  process.env.DATA_DIR = TEST_DATA_DIR;
});

afterEach(() => {
  // Clean up test data directory
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});

describe('String Encryption', () => {
  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt a string correctly', async () => {
      const plaintext = 'my-secret-password';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should produce different ciphertext for same plaintext (due to random IV)', async () => {
      const plaintext = 'test-password';
      const encrypted1 = await encrypt(plaintext);
      const encrypted2 = await encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      // But both should decrypt to the same value
      expect(await decrypt(encrypted1)).toBe(plaintext);
      expect(await decrypt(encrypted2)).toBe(plaintext);
    });

    it('should handle empty string', async () => {
      const plaintext = '';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle unicode characters', async () => {
      const plaintext = 'пароль密码🔐';
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', async () => {
      const plaintext = 'x'.repeat(10000);
      const encrypted = await encrypt(plaintext);
      const decrypted = await decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('isEncrypted', () => {
    it('should return true for encrypted values', async () => {
      const encrypted = await encrypt('test');

      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('should return false for plain strings', () => {
      expect(isEncrypted('plaintext')).toBe(false);
      expect(isEncrypted('short')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });

    it('should return false for invalid base64', () => {
      expect(isEncrypted('not-valid-base64!!!')).toBe(false);
    });
  });
});

describe('Object Field Encryption', () => {
  describe('encryptSensitiveFields', () => {
    it('should encrypt specified fields', async () => {
      const obj = {
        username: 'admin',
        password: 'secret123',
        apiKey: 'key-abc-123',
        normalField: 'unchanged',
      };

      const encrypted = await encryptSensitiveFields(obj, ['password', 'apiKey']);

      expect(encrypted.username).toBe('admin');
      expect(encrypted.normalField).toBe('unchanged');
      expect(encrypted.password).not.toBe('secret123');
      expect(encrypted.apiKey).not.toBe('key-abc-123');
      expect(isEncrypted(encrypted.password as string)).toBe(true);
      expect(isEncrypted(encrypted.apiKey as string)).toBe(true);
    });

    it('should skip non-string fields', async () => {
      const obj = {
        count: 42,
        enabled: true,
        password: 'secret',
      };

      const encrypted = await encryptSensitiveFields(obj, ['count', 'enabled', 'password']);

      expect(encrypted.count).toBe(42);
      expect(encrypted.enabled).toBe(true);
      expect(encrypted.password).not.toBe('secret');
    });

    it('should skip empty strings', async () => {
      const obj = {
        password: '',
        apiKey: 'key',
      };

      const encrypted = await encryptSensitiveFields(obj, ['password', 'apiKey']);

      expect(encrypted.password).toBe('');
      expect(encrypted.apiKey).not.toBe('key');
    });
  });

  describe('decryptSensitiveFields', () => {
    it('should decrypt encrypted fields', async () => {
      const original = {
        username: 'admin',
        password: 'secret123',
      };

      const encrypted = await encryptSensitiveFields(original, ['password']);
      const decrypted = await decryptSensitiveFields(encrypted, ['password']);

      expect(decrypted.username).toBe('admin');
      expect(decrypted.password).toBe('secret123');
    });

    it('should leave already-plain values unchanged', async () => {
      const obj = {
        password: 'plain-password',
        apiKey: 'plain-key',
      };

      const decrypted = await decryptSensitiveFields(obj, ['password', 'apiKey']);

      expect(decrypted.password).toBe('plain-password');
      expect(decrypted.apiKey).toBe('plain-key');
    });
  });
});

describe('Buffer Encryption (Backup Files)', () => {
  describe('encryptBuffer and decryptBuffer', () => {
    it('should encrypt and decrypt a buffer using default key', async () => {
      const data = Buffer.from('test backup content');
      const encrypted = await encryptBuffer(data);
      const decrypted = await decryptBuffer(encrypted);

      expect(decrypted.toString()).toBe('test backup content');
    });

    it('should encrypt and decrypt with custom passphrase', async () => {
      const data = Buffer.from('secret backup data');
      const passphrase = 'my-backup-password';

      const encrypted = await encryptBuffer(data, passphrase);
      const decrypted = await decryptBuffer(encrypted, passphrase);

      expect(decrypted.toString()).toBe('secret backup data');
    });

    it('should fail decryption with wrong passphrase', async () => {
      const data = Buffer.from('secret data');
      const encrypted = await encryptBuffer(data, 'correct-password');

      await expect(decryptBuffer(encrypted, 'wrong-password')).rejects.toThrow();
    });

    it('should handle large buffers', async () => {
      const data = Buffer.alloc(1024 * 1024, 'x'); // 1MB
      const encrypted = await encryptBuffer(data);
      const decrypted = await decryptBuffer(encrypted);

      expect(decrypted.length).toBe(data.length);
      expect(decrypted.equals(data)).toBe(true);
    });
  });

  describe('isEncryptedBackup', () => {
    it('should return true for encrypted backups', async () => {
      const data = Buffer.from('test content');
      const encrypted = await encryptBuffer(data);

      expect(isEncryptedBackup(encrypted)).toBe(true);
    });

    it('should return false for plain buffers', () => {
      expect(isEncryptedBackup(Buffer.from('plain content'))).toBe(false);
      expect(isEncryptedBackup(Buffer.from('YAML'))).toBe(false);
    });

    it('should return false for short buffers', () => {
      expect(isEncryptedBackup(Buffer.from('DBAK'))).toBe(false);
      expect(isEncryptedBackup(Buffer.from(''))).toBe(false);
    });

    it('should detect DBAK magic header', async () => {
      const encrypted = await encryptBuffer(Buffer.from('test'));

      // Check magic header is DBAK
      expect(encrypted.subarray(0, 4).toString()).toBe('DBAK');
    });
  });

  describe('decryptBuffer error handling', () => {
    it('should reject invalid magic header', async () => {
      const invalidData = Buffer.from('XXXX' + 'x'.repeat(100));

      await expect(decryptBuffer(invalidData)).rejects.toThrow('Invalid encrypted backup format');
    });

    it('should reject unsupported version', async () => {
      const data = Buffer.concat([
        Buffer.from('DBAK'),
        Buffer.from([99]), // Invalid version
        Buffer.alloc(100),
      ]);

      await expect(decryptBuffer(data)).rejects.toThrow('Unsupported backup encryption version');
    });
  });
});
