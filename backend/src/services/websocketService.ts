import WebSocket, { WebSocketServer } from 'ws';
import type { Server } from 'http';
import { createLogger } from './logger.js';
import {
  progressEmitter,
  ProgressEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
} from '../utils/progressEmitter.js';
import { jobManager } from './jobManager.js';

const log = createLogger('websocket');

// Heartbeat interval in ms
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CLIENT_TIMEOUT = 35000; // 35 seconds (slightly longer than heartbeat)

interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  clientId: string;
  subscribedJobs: Set<string>;
}

/**
 * WebSocket message types for client-server communication
 */
interface WsMessage {
  type: string;
  payload?: unknown;
}

interface JobProgressMessage extends WsMessage {
  type: 'job:progress';
  payload: ProgressEvent;
}

interface JobPhaseStartMessage extends WsMessage {
  type: 'job:phaseStart';
  payload: PhaseStartEvent;
}

interface JobPhaseCompleteMessage extends WsMessage {
  type: 'job:phaseComplete';
  payload: PhaseCompleteEvent;
}

interface JobStatusMessage extends WsMessage {
  type: 'job:status';
  payload: {
    jobId: string;
    status: string;
    progress: number;
    message?: string;
  };
}

interface HeartbeatMessage extends WsMessage {
  type: 'heartbeat';
  payload: { timestamp: string };
}

/**
 * WebSocket service for real-time updates.
 * Provides heartbeat monitoring and automatic cleanup of dead connections.
 */
class WebSocketService {
  private wss: WebSocketServer | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private clientCount = 0;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws as ExtendedWebSocket);
    });

    // Start heartbeat interval
    this.startHeartbeat();

    // Subscribe to progress events
    this.subscribeToProgressEvents();

    log.info('WebSocket server initialized');
  }

  private handleConnection(ws: ExtendedWebSocket): void {
    this.clientCount++;
    ws.isAlive = true;
    ws.clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ws.subscribedJobs = new Set();

    log.debug(
      { clientId: ws.clientId, clientCount: this.clientCount },
      'WebSocket client connected'
    );

    // Handle pong responses (heartbeat acknowledgment)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message: WsMessage = JSON.parse(data.toString());
        this.handleMessage(ws, message);
      } catch (error) {
        log.warn({ clientId: ws.clientId, error }, 'Invalid WebSocket message');
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      this.clientCount--;
      log.debug(
        { clientId: ws.clientId, clientCount: this.clientCount },
        'WebSocket client disconnected'
      );
    });

    // Handle errors
    ws.on('error', (error) => {
      log.error({ clientId: ws.clientId, error }, 'WebSocket error');
    });

    // Send welcome message
    this.send(ws, {
      type: 'connected',
      payload: { clientId: ws.clientId, timestamp: new Date().toISOString() },
    });
  }

  private handleMessage(ws: ExtendedWebSocket, message: WsMessage): void {
    switch (message.type) {
      case 'subscribe:job':
        if (
          typeof message.payload === 'object' &&
          message.payload !== null &&
          'jobId' in message.payload
        ) {
          const jobId = (message.payload as { jobId: string }).jobId;
          ws.subscribedJobs.add(jobId);
          log.debug({ clientId: ws.clientId, jobId }, 'Client subscribed to job');

          // Send current job status
          const job = jobManager.getJob(jobId);
          if (job) {
            this.send(ws, {
              type: 'job:status',
              payload: {
                jobId: job.jobId,
                status: job.status,
                progress: job.progress,
                message: job.message,
              },
            });
          }
        }
        break;

      case 'unsubscribe:job':
        if (
          typeof message.payload === 'object' &&
          message.payload !== null &&
          'jobId' in message.payload
        ) {
          const jobId = (message.payload as { jobId: string }).jobId;
          ws.subscribedJobs.delete(jobId);
          log.debug({ clientId: ws.clientId, jobId }, 'Client unsubscribed from job');
        }
        break;

      case 'ping':
        this.send(ws, { type: 'pong', payload: { timestamp: new Date().toISOString() } });
        break;

      default:
        log.debug({ clientId: ws.clientId, type: message.type }, 'Unknown message type');
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;

      this.wss.clients.forEach((ws) => {
        const extWs = ws as ExtendedWebSocket;

        if (!extWs.isAlive) {
          log.debug({ clientId: extWs.clientId }, 'Terminating unresponsive client');
          extWs.terminate();
          return;
        }

        extWs.isAlive = false;
        extWs.ping();

        // Also send a heartbeat message
        this.send(extWs, {
          type: 'heartbeat',
          payload: { timestamp: new Date().toISOString() },
        });
      });
    }, HEARTBEAT_INTERVAL);

    // Don't prevent process exit
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  private subscribeToProgressEvents(): void {
    progressEmitter.on('progress', (event: ProgressEvent) => {
      this.broadcastToJobSubscribers(event.jobId, {
        type: 'job:progress',
        payload: event,
      });
    });

    progressEmitter.on('phaseStart', (event: PhaseStartEvent) => {
      this.broadcastToJobSubscribers(event.jobId, {
        type: 'job:phaseStart',
        payload: event,
      });
    });

    progressEmitter.on('phaseComplete', (event: PhaseCompleteEvent) => {
      this.broadcastToJobSubscribers(event.jobId, {
        type: 'job:phaseComplete',
        payload: event,
      });
    });
  }

  /**
   * Broadcast a message to all clients subscribed to a specific job
   */
  private broadcastToJobSubscribers(jobId: string, message: WsMessage): void {
    if (!this.wss) return;

    this.wss.clients.forEach((ws) => {
      const extWs = ws as ExtendedWebSocket;
      if (extWs.readyState === WebSocket.OPEN && extWs.subscribedJobs.has(jobId)) {
        this.send(extWs, message);
      }
    });
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: WsMessage): void {
    if (!this.wss) return;

    this.wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        this.send(ws as ExtendedWebSocket, message);
      }
    });
  }

  /**
   * Broadcast job status update to all subscribed clients
   */
  broadcastJobStatus(jobId: string, status: string, progress: number, message?: string): void {
    this.broadcastToJobSubscribers(jobId, {
      type: 'job:status',
      payload: { jobId, status, progress, message },
    });
  }

  /**
   * Send a message to a specific client
   */
  private send(ws: ExtendedWebSocket, message: WsMessage): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      log.error({ clientId: ws.clientId, error }, 'Failed to send WebSocket message');
    }
  }

  /**
   * Get current connection statistics
   */
  getStats(): { clientCount: number; isRunning: boolean } {
    return {
      clientCount: this.clientCount,
      isRunning: this.wss !== null,
    };
  }

  /**
   * Shutdown WebSocket server gracefully
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.wss) {
      // Close all connections
      this.wss.clients.forEach((ws) => {
        ws.close(1001, 'Server shutting down');
      });
      this.wss.close();
      this.wss = null;
    }

    log.info('WebSocket server shutdown complete');
  }
}

export const websocketService = new WebSocketService();
