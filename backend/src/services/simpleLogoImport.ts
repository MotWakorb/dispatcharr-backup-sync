import { DispatcharrClient } from './dispatcharrClient.js';
import FormData from 'form-data';
import { createLogger } from './logger.js';

const log = createLogger('logo-import');

/**
 * SIMPLE logo import - no complex logic, just upload one at a time
 */
export async function simpleImportLogos(
  client: DispatcharrClient,
  logos: Array<{ original_name?: string; name?: string; source_id?: number; data: string; ext?: string }>,
  jobId?: string
): Promise<{ imported: number; errors: number; logoMap: Record<string, number> }> {
  let imported = 0;
  let errors = 0;
  const logoMap: Record<string, number> = {};

  log.debug({ count: logos.length }, 'Starting logo import');
  log.debug('First 10 logos to import:');
  for (let i = 0; i < Math.min(10, logos.length); i++) {
    const l = logos[i];
    log.debug({ index: i, name: l.name, originalName: l.original_name, sourceId: l.source_id, dataLength: l.data?.length || 0 }, 'Logo preview');
  }

  // Process each logo ONE AT A TIME
  for (let i = 0; i < logos.length; i++) {
    const logo = logos[i];
    const logoName = logo.original_name || logo.name || `logo-${i}`;
    const sourceId = logo.source_id;

    if (!logo.data) {
      log.debug({ index: i, logoName }, 'SKIP: No data');
      continue;
    }

    try {
      // Convert base64 to buffer
      const imageData = Buffer.from(logo.data, 'base64');

      // Log what we're about to upload
      const checksum = imageData.slice(0, 50).reduce((sum, byte) => (sum + byte) & 0xFFFF, 0);
      log.debug({ index: i, logoName, size: imageData.length, checksum: checksum.toString(16) }, 'Uploading logo');

      // Determine content type
      const ext = logo.ext || 'png';
      let contentType = 'image/png';
      if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
      else if (ext === 'webp') contentType = 'image/webp';
      else if (ext === 'gif') contentType = 'image/gif';
      else if (ext === 'svg') contentType = 'image/svg+xml';

      // Create form with THIS logo's data
      const form = new FormData();
      form.append('name', logoName);
      form.append('file', imageData, {
        filename: `upload_${i}.${ext}`,
        contentType,
      });

      log.debug({ index: i, logoName, checksum: checksum.toString(16), size: imageData.length }, 'Sending upload');

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
