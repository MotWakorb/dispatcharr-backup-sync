import express from 'express';
import cors from 'cors';
import { syncRouter } from './routes/sync.js';
import { exportRouter } from './routes/export.js';
import { importRouter } from './routes/import.js';
import { connectionsRouter } from './routes/connections.js';
import { savedConnectionsRouter } from './routes/savedConnections.js';
import { jobsRouter } from './routes/jobs.js';
import { schedulesRouter } from './routes/schedules.js';
import { settingsRouter } from './routes/settings.js';
import { notificationsRouter } from './routes/notifications.js';
import { infoRouter } from './routes/info.js';
import { schedulerService } from './services/schedulerService.js';
import { jobManager } from './services/jobManager.js';
import { importService } from './services/importService.js';
import { createLogger } from './services/logger.js';
import { CLEANUP_INTERVAL_MS } from './constants.js';
import { validateAndLogEnvironment } from './utils/envValidation.js';
import { correlationIdMiddleware } from './middleware/correlationId.js';
import { migrateDataIfNeeded } from './utils/dataMigration.js';
import {
  generalRateLimiter,
  authRateLimiter,
  jobCreationRateLimiter,
  uploadRateLimiter,
} from './middleware/security.js';

// Validate environment variables at startup
validateAndLogEnvironment();

// Migrate data from old location if needed (for upgrades from older versions)
migrateDataIfNeeded().catch((error) => {
  console.error('Data migration failed:', error);
});

const log = createLogger('server');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
// Accept larger payloads for import/export bundles
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ extended: true, limit: '10gb' }));

// Add correlation IDs for distributed tracing
app.use(correlationIdMiddleware);

// Log all requests with correlation ID
app.use((req, res, next) => {
  log.debug({ method: req.method, url: req.url, correlationId: req.correlationId }, 'Request');
  next();
});

// Health check with dependency status
app.get('/health', async (req, res) => {
  const startTime = Date.now();

  // Check dependencies
  const dependencies: Record<
    string,
    { status: 'healthy' | 'degraded' | 'unhealthy'; message?: string; latencyMs?: number }
  > = {};

  // Check jobManager
  try {
    await jobManager.ensureInitialized();
    dependencies.jobManager = { status: 'healthy' };
  } catch (error) {
    dependencies.jobManager = {
      status: 'unhealthy',
      message: (error as Error).message,
    };
  }

  // Check scheduler
  try {
    const schedulerHealthy = schedulerService.isInitialized();
    dependencies.scheduler = {
      status: schedulerHealthy ? 'healthy' : 'degraded',
      message: schedulerHealthy ? undefined : 'Scheduler not initialized',
    };
  } catch (error) {
    dependencies.scheduler = {
      status: 'unhealthy',
      message: (error as Error).message,
    };
  }

  // Check data directory access
  try {
    const dataDir = process.env.DATA_DIR || '/tmp/dispatcharr-manager';
    await import('fs').then((fs) => fs.promises.access(dataDir));
    dependencies.dataDirectory = { status: 'healthy' };
  } catch (error) {
    dependencies.dataDirectory = {
      status: 'unhealthy',
      message: 'Data directory not accessible',
    };
  }

  // Overall status
  const allHealthy = Object.values(dependencies).every((d) => d.status === 'healthy');
  const anyUnhealthy = Object.values(dependencies).some((d) => d.status === 'unhealthy');
  const overallStatus = allHealthy ? 'healthy' : anyUnhealthy ? 'unhealthy' : 'degraded';

  const response = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    responseTimeMs: Date.now() - startTime,
    dependencies,
    version: process.env.APP_VERSION || 'unknown',
    nodeVersion: process.version,
    memoryUsage: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };

  // Return 503 if unhealthy, 200 otherwise
  const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(response);
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
  // Dynamic import to avoid circular dependencies
  import('./utils/metrics.js')
    .then(({ metrics }) => {
      res.json(metrics.getMetrics());
    })
    .catch((err) => {
      log.error({ err }, 'Failed to load metrics');
      res.status(500).json({ error: 'Failed to load metrics' });
    });
});

// Metrics summary endpoint
app.get('/metrics/summary', (req, res) => {
  import('./utils/metrics.js')
    .then(({ metrics }) => {
      res.json(metrics.getSummary());
    })
    .catch((err) => {
      log.error({ err }, 'Failed to load metrics');
      res.status(500).json({ error: 'Failed to load metrics' });
    });
});

// Apply general rate limiter to all API routes
app.use('/api', generalRateLimiter);

// API Routes with specific rate limiters
// Job creation routes - stricter limits to prevent resource exhaustion
app.use('/api/sync', jobCreationRateLimiter, syncRouter);
app.use('/api/export', jobCreationRateLimiter, exportRouter);
app.use('/api/import', uploadRateLimiter, importRouter);

// Connection routes - auth rate limiter for test/info endpoints (brute force protection)
app.use('/api/connections', authRateLimiter, connectionsRouter);
app.use('/api/saved-connections', authRateLimiter, savedConnectionsRouter);

// Standard routes with general rate limiting (already applied above)
app.use('/api/jobs', jobsRouter);
app.use('/api/schedules', schedulesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/info', infoRouter);

// Error handling
app.use(
  (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status || 500;
    const message = (err as Error)?.message || 'Internal server error';
    log.error({ err, path: req.path, correlationId: req.correlationId }, 'Unhandled error');
    res.status(status).json({
      success: false,
      error: message,
      correlationId: req.correlationId,
    });
  }
);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
  });
});

// Temp file cleanup interval (runs every hour)
let tempCleanupInterval: ReturnType<typeof setInterval> | null = null;
let tempCleanupInProgress = false; // Lock to prevent overlapping cleanup runs

app.listen(PORT, () => {
  log.info({ port: PORT }, 'Dispatcharr Manager API running');
  log.info({ url: `http://localhost:${PORT}/health` }, 'Health check endpoint');

  // Initialize scheduler after server starts
  schedulerService.initialize().catch((error) => {
    log.error({ err: error }, 'Failed to initialize scheduler');
  });

  // Cleanup stale temp files on startup (with lock to prevent overlap)
  const runTempCleanup = async (context: string) => {
    if (tempCleanupInProgress) {
      log.debug({ context }, 'Temp cleanup already in progress, skipping');
      return;
    }
    tempCleanupInProgress = true;
    try {
      const result = await importService.cleanupStaleTempFiles();
      if (result.deleted.length > 0) {
        log.info({ count: result.deleted.length, context }, 'Cleaned up stale temp files');
      }
    } catch (error) {
      log.error({ err: error, context }, 'Temp cleanup failed');
    } finally {
      tempCleanupInProgress = false;
    }
  };

  // Run startup cleanup
  runTempCleanup('startup');

  // Start periodic temp file cleanup (every hour)
  tempCleanupInterval = setInterval(() => {
    runTempCleanup('periodic');
  }, CLEANUP_INTERVAL_MS);
  if (tempCleanupInterval.unref) {
    tempCleanupInterval.unref(); // Don't prevent process exit
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down');
  schedulerService.shutdown();
  jobManager.shutdown();
  if (tempCleanupInterval) {
    clearInterval(tempCleanupInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down');
  schedulerService.shutdown();
  jobManager.shutdown();
  if (tempCleanupInterval) {
    clearInterval(tempCleanupInterval);
  }
  process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.error({ reason, promise: String(promise) }, 'Unhandled promise rejection');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error({ err: error }, 'Uncaught exception - shutting down');
  schedulerService.shutdown();
  jobManager.shutdown();
  if (tempCleanupInterval) {
    clearInterval(tempCleanupInterval);
  }
  process.exit(1);
});
