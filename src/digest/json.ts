import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

const NIGHT_NOT_FOUND = { error: 'Night not found' } as const;

export function registerDigestJsonRoutes(app: Hono, config: RigConfig): void {
  app.get('/api/digest/:night', async (c) => {
    const night = c.req.param('night');
    const digest = await readNight(config.runsDir, night).catch((error: unknown) => {
      if (error instanceof RangeError) return null;
      throw error;
    });
    if (!digest || !digest.found) return c.json(NIGHT_NOT_FOUND, 404);
    return c.json(digest);
  });
}
