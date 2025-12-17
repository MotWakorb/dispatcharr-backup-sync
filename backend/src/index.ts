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
import { createLogger } from './services/logger.js';

const log = createLogger('server');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
// Accept larger payloads for import/export bundles
app.use(express.json({ limit: '10gb' }));
app.use(express.urlencoded({ extended: true, limit: '10gb' }));

// Log all requests
app.use((req, res, next) => {
  log.debug({ method: req.method, url: req.url }, 'Request');
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
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  log.error({ err, path: req.path }, 'Unhandled error');
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
  });
});

app.listen(PORT, () => {
  log.info({ port: PORT }, 'Dispatcharr Manager API running');
  log.info({ url: `http://localhost:${PORT}/health` }, 'Health check endpoint');

  // Initialize scheduler after server starts
  schedulerService.initialize().catch((error) => {
    log.error({ err: error }, 'Failed to initialize scheduler');
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  log.info('SIGTERM received, shutting down');
  schedulerService.shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  log.info('SIGINT received, shutting down');
  schedulerService.shutdown();
  process.exit(0);
});
