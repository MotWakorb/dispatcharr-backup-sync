import { Router } from 'express';
import axios from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../services/logger.js';
import { getErrorMessage } from '../utils/errorUtils.js';
import { CACHE_TTL_MS, GITHUB_TIMEOUT_MS } from '../constants.js';

const log = createLogger('info-route');

const router = Router();

// GitHub repository info
const GITHUB_OWNER = 'motwakorb';
const GITHUB_REPO = 'dispatcharr-backup-sync';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

// Cache for GitHub release info (1 hour TTL)
let releaseCache: {
  latestVersion: string | null;
  releaseUrl: string | null;
  fetchedAt: number;
} | null = null;

// CACHE_TTL_MS imported from constants

async function getCurrentVersion(): Promise<string> {
  // First try environment variable (set at Docker build time)
  if (process.env.APP_VERSION) {
    return process.env.APP_VERSION;
  }

  // Fall back to VERSION file
  try {
    // Try multiple possible locations
    const possiblePaths = [
      path.join(process.cwd(), 'VERSION'),
      path.join(process.cwd(), '..', 'VERSION'),
      '/app/VERSION',
    ];

    for (const versionPath of possiblePaths) {
      try {
        const version = await fs.readFile(versionPath, 'utf-8');
        return version.trim();
      } catch {
        // Try next path
      }
    }
  } catch {
    // Ignore errors
  }

  return 'unknown';
}

async function getLatestRelease(): Promise<{
  latestVersion: string | null;
  releaseUrl: string | null;
}> {
  // Check cache
  if (releaseCache && Date.now() - releaseCache.fetchedAt < CACHE_TTL_MS) {
    return {
      latestVersion: releaseCache.latestVersion,
      releaseUrl: releaseCache.releaseUrl,
    };
  }

  try {
    const response = await axios.get(GITHUB_API_URL, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'dispatcharr-backup-sync',
      },
      timeout: GITHUB_TIMEOUT_MS,
    });

    const tagName = response.data.tag_name as string;
    // Remove 'v' prefix if present
    const latestVersion = tagName.startsWith('v') ? tagName.slice(1) : tagName;
    const releaseUrl = response.data.html_url as string;

    // Update cache
    releaseCache = {
      latestVersion,
      releaseUrl,
      fetchedAt: Date.now(),
    };

    return { latestVersion, releaseUrl };
  } catch (error) {
    log.warn({ err: error }, 'Failed to fetch latest release from GitHub');
    return { latestVersion: null, releaseUrl: null };
  }
}

function compareVersions(current: string, latest: string): boolean {
  // Simple semver comparison
  const currentParts = current.split('.').map((p) => parseInt(p, 10) || 0);
  const latestParts = latest.split('.').map((p) => parseInt(p, 10) || 0);

  // Pad arrays to same length
  while (currentParts.length < 3) currentParts.push(0);
  while (latestParts.length < 3) latestParts.push(0);

  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true;
    if (latestParts[i] < currentParts[i]) return false;
  }

  return false;
}

// GET /api/info - Get version info
router.get('/', async (req, res) => {
  try {
    const currentVersion = await getCurrentVersion();
    const { latestVersion, releaseUrl } = await getLatestRelease();

    const updateAvailable =
      latestVersion !== null &&
      currentVersion !== 'unknown' &&
      compareVersions(currentVersion, latestVersion);

    res.json({
      success: true,
      data: {
        currentVersion,
        latestVersion,
        updateAvailable,
        releaseUrl: updateAvailable ? releaseUrl : null,
      },
    });
  } catch (error) {
    log.error({ err: error }, 'Error getting version info');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to get version info'),
    });
  }
});

export const infoRouter = router;
