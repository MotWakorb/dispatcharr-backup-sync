import express from 'express';
import cors from 'cors';
import { syncRouter } from './routes/sync.js';
import { exportRouter } from './routes/export.js';
import { importRouter } from './routes/import.js';
import { connectionsRouter } from './routes/connections.js';
import { savedConnectionsRouter } from './routes/savedConnections.js';
import { jobsRouter } from './routes/jobs.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
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
  console.log(`Dispatcharr Manager API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
