import { DispatcharrClient } from './dispatcharrClient.js';
import FormData from 'form-data';
import { createLogger } from './logger.js';
import type { SimpleLogoImportResult } from '../types/index.js';

const log = createLogger('logo-import');

// Maximum logo file size (50MB - reasonable limit for a single logo)
const MAX_LOGO_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Estimates the decoded size of a base64 string.
 */
function estimateBase64DecodedSize(base64String: string): number {
  const cleanLength = base64String.replace(/[\s=]/g, '').length;
  return Math.ceil(cleanLength * 0.75);
}

/**
 * Safely decode a base64 string with size validation.
 */
function safeBase64Decode(base64String: string, maxSize: number, context: string): Buffer {
  const estimatedSize = estimateBase64DecodedSize(base64String);
  if (estimatedSize > maxSize) {
    const sizeMB = (estimatedSize / (1024 * 1024)).toFixed(2);
    const limitMB = (maxSize / (1024 * 1024)).toFixed(2);
    throw new Error(`${context}: File size (${sizeMB}MB) exceeds maximum allowed (${limitMB}MB)`);
  }
  return Buffer.from(base64String, 'base64');
}

/**
 * SIMPLE logo import - no complex logic, just upload one at a time
 * Supports both file-based logos (with data) and URL-based logos (with url)
 */
export async function simpleImportLogos(
  client: DispatcharrClient,
  logos: Array<{
    original_name?: string;
    name?: string;
    source_id?: number;
    data: string;
    ext?: string;
    url?: string;
  }>,
  jobId?: string
): Promise<SimpleLogoImportResult> {
  let imported = 0;
  let errors = 0;
  const logoMap: Record<string, number> = {};

  log.debug({ count: logos.length }, 'Starting logo import');
  log.debug('First 10 logos to import:');
  for (let i = 0; i < Math.min(10, logos.length); i++) {
    const l = logos[i];
    log.debug(
      {
        index: i,
        name: l.name,
        originalName: l.original_name,
        sourceId: l.source_id,
        dataLength: l.data?.length || 0,
      },
      'Logo preview'
    );
  }

  // Process each logo ONE AT A TIME
  for (let i = 0; i < logos.length; i++) {
    const logo = logos[i];
    const logoName = logo.original_name || logo.name || `logo-${i}`;
    const sourceId = logo.source_id;

    // Check if this is a URL-based logo or file-based logo
    const isUrlBased = !logo.data && logo.url;

    if (!logo.data && !logo.url) {
      log.debug({ index: i, logoName }, 'SKIP: No data and no URL');
      continue;
    }

    try {
      if (isUrlBased) {
        // URL-based logo: just create a logo entry with the URL reference
        // Don't download and re-upload - just pass the URL to destination
        log.debug({ index: i, logoName, url: logo.url }, 'Creating logo with URL reference');

        try {
          const result = await client.post('/api/channels/logos/', {
            name: logoName,
            url: logo.url,
          });

          const newId = result?.id || result?.data?.id;
          log.debug({ index: i, id: newId, name: logoName, url: logo.url }, 'URL logo created');

          // Store mapping
          if (newId && sourceId) {
            logoMap[`src:${sourceId}`] = newId;
          }

          imported++;
        } catch (createError: any) {
          log.error(
            { index: i, logoName, url: logo.url, err: createError },
            'Failed to create URL logo reference'
          );
          errors++;
        }
        continue;
      }

      // File-based logo: decode base64 data and upload
      let imageData: Buffer;
      let ext: string;
      let contentType: string;

      imageData = safeBase64Decode(logo.data, MAX_LOGO_FILE_SIZE, `Logo "${logoName}"`);
      ext = logo.ext || 'png';
      contentType = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (ext === 'gif') contentType = 'image/gif';
      else if (ext === 'svg') contentType = 'image/svg+xml';

      // Log what we're about to upload
      const checksum = imageData.slice(0, 50).reduce((sum, byte) => (sum + byte) & 0xffff, 0);
      log.debug(
        { index: i, logoName, size: imageData.length, checksum: checksum.toString(16) },
        'Uploading logo'
      );

      // Create form with THIS logo's data
      const form = new FormData();
      form.append('name', logoName);
      form.append('file', imageData, {
        filename: `upload_${i}.${ext}`,
        contentType,
      });

      log.debug(
        { index: i, logoName, checksum: checksum.toString(16), size: imageData.length },
        'Sending upload'
      );

      // Upload THIS logo and wait for completion
      const result = await client.post('/api/channels/logos/upload/', form, {
        headers: form.getHeaders(),
      });

      const newId = result?.id || result?.data?.id;
      const returnedName = result?.name || result?.data?.name;
      const returnedUrl = result?.url || result?.data?.url;

      log.debug({ index: i, id: newId, name: returnedName, url: returnedUrl }, 'Upload completed');

      // Store mapping
      if (newId && sourceId) {
        logoMap[`src:${sourceId}`] = newId;
      }

      imported++;
    } catch (error: any) {
      log.error({ index: i, logoName, err: error }, 'Logo upload failed');
      errors++;
    }
  }

  log.info({ imported, errors }, 'Logo import complete');
  return { imported, errors, logoMap };
}
