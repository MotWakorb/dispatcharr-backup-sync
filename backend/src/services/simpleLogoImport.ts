import { DispatcharrClient } from './dispatcharrClient.js';
import FormData from 'form-data';
import { createLogger } from './logger.js';
import type { SimpleLogoImportResult } from '../types/index.js';
import {
  MAX_LOGO_FILE_SIZE,
  safeBase64Decode,
  getLogoContentType,
  calculateLogoChecksum,
  estimateBase64DecodedSize,
  CumulativeMemoryTracker,
} from '../utils/logoUtils.js';

const log = createLogger('logo-import');

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
  const memoryTracker = new CumulativeMemoryTracker();

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
      // Check cumulative memory before decoding to prevent memory exhaustion
      const estimatedSize = estimateBase64DecodedSize(logo.data);
      memoryTracker.checkAndAdd(estimatedSize, `Logo import batch at "${logoName}"`);

      const imageData = safeBase64Decode(logo.data, MAX_LOGO_FILE_SIZE, `Logo "${logoName}"`);
      const ext = logo.ext || 'png';
      const contentType = getLogoContentType(ext);

      // Log what we're about to upload
      const checksum = calculateLogoChecksum(imageData);
      log.debug({ index: i, logoName, size: imageData.length, checksum }, 'Uploading logo');

      // Create form with THIS logo's data
      const form = new FormData();
      form.append('name', logoName);
      form.append('file', imageData, {
        filename: `upload_${i}.${ext}`,
        contentType,
      });

      log.debug({ index: i, logoName, checksum, size: imageData.length }, 'Sending upload');

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
