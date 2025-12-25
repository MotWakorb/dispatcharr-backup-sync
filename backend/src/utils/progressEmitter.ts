import { EventEmitter } from 'events';
import { createLogger } from '../services/logger.js';

const log = createLogger('progress');

/**
 * Progress event types
 */
export interface ProgressEvent {
  jobId: string;
  phase: string;
  current: number;
  total: number;
  percentage: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface PhaseStartEvent {
  jobId: string;
  phase: string;
  total?: number;
  message?: string;
}

export interface PhaseCompleteEvent {
  jobId: string;
  phase: string;
  duration: number;
  itemsProcessed: number;
  message?: string;
}

export interface ErrorEvent {
  jobId: string;
  phase: string;
  error: string;
  details?: Record<string, unknown>;
}

/**
 * Progress emitter for tracking long-running operations.
 * Emits events that can be consumed by WebSocket handlers, logging, or other listeners.
 */
class ProgressEmitterClass extends EventEmitter {
  private phaseStartTimes: Map<string, number> = new Map();
  private phaseCounts: Map<string, number> = new Map();

  constructor() {
    super();
    // Increase max listeners since multiple jobs may be running
    this.setMaxListeners(50);
  }

  /**
   * Start a new phase of a job
   */
  startPhase(jobId: string, phase: string, total?: number, message?: string): void {
    const key = `${jobId}:${phase}`;
    this.phaseStartTimes.set(key, Date.now());
    this.phaseCounts.set(key, 0);

    const event: PhaseStartEvent = { jobId, phase, total, message };
    this.emit('phaseStart', event);
    log.debug({ jobId: jobId.slice(0, 8), phase, total }, message || `Phase started: ${phase}`);
  }

  /**
   * Report progress within a phase
   */
  progress(
    jobId: string,
    phase: string,
    current: number,
    total: number,
    message?: string,
    details?: Record<string, unknown>
  ): void {
    const key = `${jobId}:${phase}`;
    this.phaseCounts.set(key, current);

    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const event: ProgressEvent = {
      jobId,
      phase,
      current,
      total,
      percentage,
      message,
      details,
    };

    this.emit('progress', event);

    // Log progress at 10% intervals to reduce noise
    if (current === 1 || current === total || percentage % 10 === 0) {
      log.debug(
        { jobId: jobId.slice(0, 8), phase, progress: `${current}/${total} (${percentage}%)` },
        message || `Progress: ${phase}`
      );
    }
  }

  /**
   * Complete a phase
   */
  completePhase(jobId: string, phase: string, message?: string): void {
    const key = `${jobId}:${phase}`;
    const startTime = this.phaseStartTimes.get(key);
    const count = this.phaseCounts.get(key) || 0;

    const duration = startTime ? Date.now() - startTime : 0;

    const event: PhaseCompleteEvent = {
      jobId,
      phase,
      duration,
      itemsProcessed: count,
      message,
    };

    this.emit('phaseComplete', event);
    log.debug(
      { jobId: jobId.slice(0, 8), phase, duration, itemsProcessed: count },
      message || `Phase complete: ${phase}`
    );

    // Cleanup
    this.phaseStartTimes.delete(key);
    this.phaseCounts.delete(key);
  }

  /**
   * Report an error in a phase
   */
  error(jobId: string, phase: string, error: string, details?: Record<string, unknown>): void {
    const event: ErrorEvent = { jobId, phase, error, details };
    this.emit('error', event);
    log.error({ jobId: jobId.slice(0, 8), phase, error, details }, `Error in phase: ${phase}`);
  }

  /**
   * Cleanup all tracking data for a job
   */
  cleanupJob(jobId: string): void {
    for (const key of this.phaseStartTimes.keys()) {
      if (key.startsWith(`${jobId}:`)) {
        this.phaseStartTimes.delete(key);
      }
    }
    for (const key of this.phaseCounts.keys()) {
      if (key.startsWith(`${jobId}:`)) {
        this.phaseCounts.delete(key);
      }
    }
  }
}

/**
 * Singleton progress emitter instance
 */
export const progressEmitter = new ProgressEmitterClass();

/**
 * Helper class for tracking progress within a specific job/phase
 */
export class ProgressTracker {
  private current = 0;

  constructor(
    private jobId: string,
    private phase: string,
    private total: number
  ) {
    progressEmitter.startPhase(jobId, phase, total);
  }

  /**
   * Increment progress by 1
   */
  increment(message?: string, details?: Record<string, unknown>): void {
    this.current++;
    progressEmitter.progress(this.jobId, this.phase, this.current, this.total, message, details);
  }

  /**
   * Set progress to a specific value
   */
  set(current: number, message?: string, details?: Record<string, unknown>): void {
    this.current = current;
    progressEmitter.progress(this.jobId, this.phase, this.current, this.total, message, details);
  }

  /**
   * Update total (useful when total is discovered during processing)
   */
  updateTotal(total: number): void {
    this.total = total;
  }

  /**
   * Complete the phase
   */
  complete(message?: string): void {
    progressEmitter.completePhase(this.jobId, this.phase, message);
  }

  /**
   * Report an error
   */
  error(error: string, details?: Record<string, unknown>): void {
    progressEmitter.error(this.jobId, this.phase, error, details);
  }

  /**
   * Get current percentage
   */
  get percentage(): number {
    return this.total > 0 ? Math.round((this.current / this.total) * 100) : 0;
  }
}
