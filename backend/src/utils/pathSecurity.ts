import path from 'path';

/**
 * Sanitize a filename to prevent path traversal attacks.
 * Removes any directory components and dangerous characters.
 *
 * @param filename - The filename to sanitize (may contain path components)
 * @returns A safe filename containing only the base name
 */
export function sanitizeFilename(filename: string): string {
  // Get only the base filename (removes directory traversal like ../)
  let safeName = path.basename(filename);

  // Remove null bytes
  safeName = safeName.replace(/\0/g, '');

  // Remove any remaining path separators (shouldn't exist after basename, but be safe)
  safeName = safeName.replace(/[/\\]/g, '');

  // Reject empty or dot-only names
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new Error('Invalid filename');
  }

  return safeName;
}

/**
 * Safely join a path while ensuring the result stays within the base directory.
 * Prevents path traversal attacks by validating the resolved path.
 *
 * @param baseDir - The base directory that the result must stay within
 * @param unsafePath - The potentially unsafe path to join
 * @returns The safely joined path
 * @throws Error if the resulting path would be outside baseDir
 */
export function safePathJoin(baseDir: string, unsafePath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const joined = path.join(baseDir, unsafePath);
  const resolvedJoined = path.resolve(joined);

  // Ensure the resolved path is within the base directory
  if (!resolvedJoined.startsWith(resolvedBase + path.sep) && resolvedJoined !== resolvedBase) {
    throw new Error('Path traversal attempt detected');
  }

  return resolvedJoined;
}
