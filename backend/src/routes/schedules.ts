import { Router } from 'express';
import { scheduleStore } from '../services/scheduleStore.js';
import { schedulerService } from '../services/schedulerService.js';
import { savedConnectionStore } from '../services/savedConnectionStore.js';
import type { ApiResponse, Schedule, ScheduleInput, ScheduleRunHistoryEntry } from '../types/index.js';

export const schedulesRouter = Router();

async function validateInput(input: ScheduleInput): Promise<string | null> {
  if (!input.name || !input.name.trim()) {
    return 'name is required';
  }
  if (!input.jobType || !['backup', 'sync'].includes(input.jobType)) {
    return 'jobType must be "backup" or "sync"';
  }
  if (!input.sourceConnectionId) {
    return 'sourceConnectionId is required';
  }
  if (!input.options) {
    return 'options are required';
  }
  if (!input.schedulePreset || !['hourly', 'daily', 'weekly', 'monthly', 'custom'].includes(input.schedulePreset)) {
    return 'schedulePreset must be one of: hourly, daily, weekly, monthly, custom';
  }
  if (input.schedulePreset === 'custom' && !input.cronExpression) {
    return 'cronExpression is required for custom schedules';
  }
  if (input.cronExpression && !schedulerService.validateCron(input.cronExpression)) {
    return 'Invalid cron expression';
  }
  if (input.jobType === 'sync' && !input.destinationConnectionId) {
    return 'destinationConnectionId is required for sync jobs';
  }

  // Validate connections exist
  const sourceConn = await savedConnectionStore.getById(input.sourceConnectionId);
  if (!sourceConn) {
    return 'Source connection not found';
  }
  if (input.jobType === 'sync' && input.destinationConnectionId) {
    const destConn = await savedConnectionStore.getById(input.destinationConnectionId);
    if (!destConn) {
      return 'Destination connection not found';
    }
  }

  return null;
}

// List all schedules
schedulesRouter.get('/', async (_req, res) => {
  try {
    const schedules = await scheduleStore.getAll();
    // Add running status to each schedule
    const schedulesWithStatus = schedules.map(s => ({
      ...s,
      isRunning: schedulerService.isRunning(s.id),
      runningJobId: schedulerService.getRunningJobId(s.id),
    }));
    res.json({
      success: true,
      data: schedulesWithStatus,
    } as ApiResponse<Schedule[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list schedules',
    } as ApiResponse);
  }
});

// Get single schedule
schedulesRouter.get('/:id', async (req, res) => {
  try {
    const schedule = await scheduleStore.getById(req.params.id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      } as ApiResponse);
    }
    res.json({
      success: true,
      data: {
        ...schedule,
        isRunning: schedulerService.isRunning(schedule.id),
        runningJobId: schedulerService.getRunningJobId(schedule.id),
      },
    } as ApiResponse<Schedule>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get schedule',
    } as ApiResponse);
  }
});

// Create schedule
schedulesRouter.post('/', async (req, res) => {
  try {
    const input: ScheduleInput = req.body;
    const validationError = await validateInput(input);
    if (validationError) {
      return res.status(400).json({
        success: false,
        error: validationError,
      } as ApiResponse);
    }

    // Cache connection names in case connections are deleted later
    const sourceConn = await savedConnectionStore.getById(input.sourceConnectionId);
    if (sourceConn) {
      input.sourceConnectionName = sourceConn.name;
    }
    if (input.destinationConnectionId) {
      const destConn = await savedConnectionStore.getById(input.destinationConnectionId);
      if (destConn) {
        input.destinationConnectionName = destConn.name;
      }
    }

    const schedule = await scheduleStore.create(input);

    // Schedule if enabled
    if (schedule.enabled) {
      await schedulerService.scheduleJob(schedule);
    }

    res.status(201).json({
      success: true,
      data: schedule,
      message: 'Schedule created',
    } as ApiResponse<Schedule>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create schedule',
    } as ApiResponse);
  }
});

// Update schedule
schedulesRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await scheduleStore.getById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      } as ApiResponse);
    }

    const input: Partial<ScheduleInput> = req.body;

    // Validate cron if provided
    if (input.cronExpression && !schedulerService.validateCron(input.cronExpression)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid cron expression',
      } as ApiResponse);
    }

    // Validate connections if changed and cache names
    if (input.sourceConnectionId) {
      const sourceConn = await savedConnectionStore.getById(input.sourceConnectionId);
      if (!sourceConn) {
        return res.status(400).json({
          success: false,
          error: 'Source connection not found',
        } as ApiResponse);
      }
      input.sourceConnectionName = sourceConn.name;
    }
    if (input.destinationConnectionId) {
      const destConn = await savedConnectionStore.getById(input.destinationConnectionId);
      if (!destConn) {
        return res.status(400).json({
          success: false,
          error: 'Destination connection not found',
        } as ApiResponse);
      }
      input.destinationConnectionName = destConn.name;
    }

    const schedule = await scheduleStore.update(id, input);

    // Reschedule or unschedule based on enabled status
    if (schedule.enabled) {
      await schedulerService.scheduleJob(schedule);
    } else {
      schedulerService.unscheduleJob(schedule.id);
    }

    res.json({
      success: true,
      data: schedule,
      message: 'Schedule updated',
    } as ApiResponse<Schedule>);
  } catch (error: any) {
    const status = error.message === 'Schedule not found' ? 404 : 500;
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to update schedule',
    } as ApiResponse);
  }
});

// Delete schedule
schedulesRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await scheduleStore.getById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      } as ApiResponse);
    }

    // Check if currently running
    if (schedulerService.isRunning(id)) {
      return res.status(409).json({
        success: false,
        error: 'Cannot delete a schedule that is currently running',
      } as ApiResponse);
    }

    schedulerService.unscheduleJob(id);
    await scheduleStore.delete(id);

    res.json({
      success: true,
      message: 'Schedule deleted',
    } as ApiResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete schedule',
    } as ApiResponse);
  }
});

// Toggle enabled status
schedulesRouter.post('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await scheduleStore.getById(id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      } as ApiResponse);
    }

    const updated = await scheduleStore.update(id, {
      enabled: !schedule.enabled,
    });

    if (updated.enabled) {
      await schedulerService.scheduleJob(updated);
    } else {
      schedulerService.unscheduleJob(updated.id);
    }

    res.json({
      success: true,
      data: updated,
      message: `Schedule ${updated.enabled ? 'enabled' : 'disabled'}`,
    } as ApiResponse<Schedule>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to toggle schedule',
    } as ApiResponse);
  }
});

// Trigger manual run
schedulesRouter.post('/:id/run', async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await scheduleStore.getById(id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      } as ApiResponse);
    }

    if (schedulerService.isRunning(id)) {
      return res.status(409).json({
        success: false,
        error: 'Schedule is already running',
      } as ApiResponse);
    }

    // Execute asynchronously - don't wait for completion
    schedulerService.triggerManualRun(id).catch((error) => {
      console.error(`Manual run failed for schedule ${id}:`, error);
    });

    res.json({
      success: true,
      message: 'Schedule run triggered',
    } as ApiResponse);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to trigger schedule run',
    } as ApiResponse);
  }
});

// Get run history for a schedule
schedulesRouter.get('/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await scheduleStore.getById(id);
    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found',
      } as ApiResponse);
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const history = await scheduleStore.getRunHistory(id, limit);

    res.json({
      success: true,
      data: history,
    } as ApiResponse<ScheduleRunHistoryEntry[]>);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get schedule history',
    } as ApiResponse);
  }
});

// Validate cron expression
schedulesRouter.post('/validate-cron', (req, res) => {
  const { expression } = req.body;
  if (!expression) {
    return res.status(400).json({
      success: false,
      error: 'expression is required',
    } as ApiResponse);
  }

  const isValid = schedulerService.validateCron(expression);
  res.json({
    success: true,
    data: { valid: isValid },
  } as ApiResponse<{ valid: boolean }>);
});
