/**
 * Shared utilities for logo processing across export, import, and sync services.
 */

/**
 * Maximum logo file size (50MB - reasonable limit for a single logo)
 */
export const MAX_LOGO_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Maximum cumulative decoded size for batch operations (500MB)
 * Prevents memory exhaustion when importing many logos
 */
export const MAX_CUMULATIVE_DECODE_SIZE = 500 * 1024 * 1024;

/**
 * Tracks cumulative memory usage during batch decoding operations.
 * Use this to prevent memory exhaustion when decoding many base64 items.
 */
export class CumulativeMemoryTracker {
  private totalBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number = MAX_CUMULATIVE_DECODE_SIZE) {
    this.maxBytes = maxBytes;
  }

  /**
   * Checks if adding the specified size would exceed the limit.
   * @param bytes - The size to add
   * @param context - Context for error message
   * @throws Error if adding would exceed limit
   */
  checkAndAdd(bytes: number, context: string): void {
    if (this.totalBytes + bytes > this.maxBytes) {
      const totalMB = ((this.totalBytes + bytes) / (1024 * 1024)).toFixed(2);
      const limitMB = (this.maxBytes / (1024 * 1024)).toFixed(2);
      throw new Error(
        `${context}: Cumulative decoded size (${totalMB}MB) would exceed limit (${limitMB}MB). ` +
          `Consider reducing the number of embedded logos or using URL references instead.`
      );
    }
    this.totalBytes += bytes;
  }

  /**
   * Gets the current total bytes tracked.
   */
  getTotal(): number {
    return this.totalBytes;
  }

  /**
   * Resets the tracker (e.g., after buffers are released).
   */
  reset(): void {
    this.totalBytes = 0;
  }
}

/**
 * Common image extensions for logo files
 */
export const VALID_LOGO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const;
export type LogoExtension = (typeof VALID_LOGO_EXTENSIONS)[number];

/**
 * Metadata for a logo file or URL
 */
export interface LogoMetadata {
  name: string;
  ext: LogoExtension;
  isUrl: boolean;
  url?: string;
  sourceId?: number;
}

/**
 * Checks if a URL is an external URL (not a local Dispatcharr file reference)
 * @param url - The URL to check
 * @returns true if the URL is external (http/https but not local)
 */
export function isExternalUrl(url: string | undefined): boolean {
  if (!url) return false;
  // Check for http/https URLs that aren't local Dispatcharr references
  return (
    (url.startsWith('http://') || url.startsWith('https://')) &&
    !url.includes('/api/channels/logos/') &&
    !url.includes('/media/logos/')
  );
}

/**
 * Gets the content type for a logo based on its file extension
 * @param ext - The file extension (without leading dot)
 * @returns The MIME content type string
 */
export function getLogoContentType(ext: string): string {
  const normalizedExt = ext.toLowerCase().replace(/^\./, '');
  switch (normalizedExt) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
    default:
      return 'image/png';
  }
}

/**
 * Extracts file extension from a filename or URL
 * @param filename - The filename or URL to extract extension from
 * @returns The lowercase extension without the leading dot, or 'png' as default
 */
export function getLogoExtension(filename: string): string {
  if (!filename) return 'png';

  // Handle URLs - extract path before query params
  let path = filename;
  if (filename.includes('?')) {
    path = filename.split('?')[0];
  }

  // Get the extension
  const parts = path.split('.');
  if (parts.length > 1) {
    const ext = parts[parts.length - 1].toLowerCase();
    if (VALID_LOGO_EXTENSIONS.includes(ext as LogoExtension)) {
      return ext;
    }
  }

  return 'png';
}

/**
 * Calculates a simple checksum for logo data (for debugging/comparison)
 * @param buffer - The logo data buffer
 * @returns A hex string checksum
 */
export function calculateLogoChecksum(buffer: Buffer): string {
  // Simple checksum for debugging - first 50 bytes summed
  const checksum = buffer.slice(0, 50).reduce((sum, byte) => (sum + byte) & 0xffff, 0);
  return checksum.toString(16).padStart(4, '0');
}

/**
 * Estimates the decoded size of a base64 string
 * @param base64String - The base64 encoded string
 * @returns The estimated decoded size in bytes
 */
export function estimateBase64DecodedSize(base64String: string): number {
  const cleanLength = base64String.replace(/[\s=]/g, '').length;
  return Math.ceil(cleanLength * 0.75);
}

/**
 * Safely decodes a base64 string with size validation
 * @param base64String - The base64 encoded string
 * @param maxSize - Maximum allowed decoded size in bytes
 * @param context - Context string for error messages (e.g., "Logo 'mylogo.png'")
 * @returns The decoded buffer
 * @throws Error if the decoded size would exceed maxSize
 */
export function safeBase64Decode(base64String: string, maxSize: number, context: string): Buffer {
  const estimatedSize = estimateBase64DecodedSize(base64String);
  if (estimatedSize > maxSize) {
    const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
    const limitMB = (maxSize / (1024 * 1024)).toFixed(2);
    throw new Error(`${context}: File size (${sizeMB}MB) exceeds maximum allowed (${limitMB}MB)`);
  }
  return Buffer.from(base64String, 'base64');
}

/**
 * Sanitizes a logo filename by replacing unsafe characters
 * @param name - The original logo name
 * @returns A sanitized filename safe for filesystem operations
 */
export function sanitizeLogoFilename(name: string): string {
  if (!name) return 'logo';
  // Replace unsafe characters with underscores, preserve extension if present
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .trim();
}

/**
 * Builds a logo map key from various identifier types
 * Supports multiple key formats for flexible lookups:
 * - "src:123" for source ID (most reliable)
 * - "name:abc" for original name
 * - "file:abc" for sanitized filename
 */
export function buildLogoMapKey(type: 'src' | 'name' | 'file', value: string | number): string {
  return `${type}:${String(value).toLowerCase()}`;
}

/**
 * Parses a logo URL to extract useful information
 * @param url - The logo URL to parse
 * @returns Object with parsed information or null if invalid
 */
export function parseLogoUrl(url: string | undefined): {
  isExternal: boolean;
  extension: string;
  isLocal: boolean;
} | null {
  if (!url) return null;

  return {
    isExternal: isExternalUrl(url),
    extension: getLogoExtension(url),
    isLocal:
      url.includes('/api/channels/logos/') || url.includes('/media/logos/') || url.startsWith('/'),
  };
}
