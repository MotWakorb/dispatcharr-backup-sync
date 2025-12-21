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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/sync', syncRouter);
app.use('/api/export', exportRouter);
app.use('/api/import', importRouter);
app.use('/api/connections', connectionsRouter);
app.use('/api/saved-connections', savedConnectionsRouter);
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

app.listen(PORT, () => {
  log.info({ port: PORT }, 'Dispatcharr Manager API running');
  log.info({ url: `http://localhost:${PORT}/health` }, 'Health check endpoint');

  // Initialize scheduler after server starts
  schedulerService.initialize().catch((error) => {
    log.error({ err: error }, 'Failed to initialize scheduler');
  });

  // Cleanup stale temp files on startup
  importService
    .cleanupStaleTempFiles()
    .then((result) => {
      if (result.deleted.length > 0) {
        log.info({ count: result.deleted.length }, 'Startup: Cleaned up stale temp files');
      }
    })
    .catch((error) => {
      log.error({ err: error }, 'Startup: Failed to cleanup temp files');
    });

  // Start periodic temp file cleanup (every hour)
  tempCleanupInterval = setInterval(() => {
    importService.cleanupStaleTempFiles().catch((error) => {
      log.error({ err: error }, 'Periodic temp cleanup failed');
    });
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
