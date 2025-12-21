import { Router } from 'express';
import { savedConnectionStore } from '../services/savedConnectionStore.js';
import { createLogger } from '../services/logger.js';
import { getErrorMessage } from '../utils/errorUtils.js';
import type { ApiResponse, SavedConnection, SavedConnectionInput } from '../types/index.js';

const log = createLogger('saved-connections-route');

export const savedConnectionsRouter = Router();

function validateInput(input: SavedConnectionInput) {
  if (!input.name || !input.instanceUrl || !input.username || !input.password) {
    return 'name, instanceUrl, username, and password are required';
  }
  return null;
}

// List saved connections
savedConnectionsRouter.get('/', async (_req, res) => {
  try {
    const connections = await savedConnectionStore.getAll();
    log.debug({ count: connections.length }, 'Listed saved connections');
    res.json({
      success: true,
      data: connections,
    } as ApiResponse<SavedConnection[]>);
  } catch (error) {
    log.error({ err: error }, 'Failed to list saved connections');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to list saved connections'),
    } as ApiResponse);
  }
});

// Create saved connection
savedConnectionsRouter.post('/', async (req, res) => {
  try {
    const input: SavedConnectionInput = req.body;
    const validationError = validateInput(input);
    if (validationError) {
      log.warn({ name: input.name, error: validationError }, 'Invalid saved connection input');
      return res.status(400).json({
        success: false,
        error: validationError,
      } as ApiResponse);
    }

    const saved = await savedConnectionStore.create(input);
    log.info(
      { id: saved.id, name: saved.name, url: saved.instanceUrl },
      'Saved connection created'
    );
    res.status(201).json({
      success: true,
      data: saved,
      message: 'Saved connection created',
    } as ApiResponse<SavedConnection>);
  } catch (error) {
    log.error({ err: error }, 'Failed to create saved connection');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to create saved connection'),
    } as ApiResponse);
  }
});

// Update saved connection
savedConnectionsRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const input: SavedConnectionInput = req.body;
    const validationError = validateInput(input);
    if (validationError) {
      log.warn({ id, error: validationError }, 'Invalid saved connection update input');
      return res.status(400).json({
        success: false,
        error: validationError,
      } as ApiResponse);
    }

    const updated = await savedConnectionStore.update(id, input);
    log.info({ id, name: updated.name }, 'Saved connection updated');
    res.json({
      success: true,
      data: updated,
      message: 'Saved connection updated',
    } as ApiResponse<SavedConnection>);
  } catch (error) {
    const errorMsg = getErrorMessage(error);
    const isNotFound = errorMsg === 'Saved connection not found';
    if (isNotFound) {
      log.warn({ id: req.params.id }, 'Attempted to update non-existent saved connection');
    } else {
      log.error({ err: error, id: req.params.id }, 'Failed to update saved connection');
    }
    res.status(isNotFound ? 404 : 500).json({
      success: false,
      error: isNotFound ? errorMsg : getErrorMessage(error, 'Failed to update saved connection'),
    } as ApiResponse);
  }
});

// Delete saved connection
savedConnectionsRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await savedConnectionStore.getById(id);
    if (!existing) {
      log.warn({ id }, 'Attempted to delete non-existent saved connection');
      return res.status(404).json({
        success: false,
        error: 'Saved connection not found',
      } as ApiResponse);
    }

    await savedConnectionStore.delete(id);
    log.info({ id, name: existing.name }, 'Saved connection deleted');
    res.json({
      success: true,
      message: 'Saved connection deleted',
    } as ApiResponse);
  } catch (error) {
    log.error({ err: error, id: req.params.id }, 'Failed to delete saved connection');
    res.status(500).json({
      success: false,
      error: getErrorMessage(error, 'Failed to delete saved connection'),
    } as ApiResponse);
  }
});
