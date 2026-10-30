import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { registerDigestJsonRoutes } from './digest/json.js';
import { readNight } from './digest/reader.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { DigestPage } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', async (c) => {
    const status = await readStatus(config);
    return c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={status} />
      </Layout>,
    );
  });

  app.get('/digest/:night', async (c) => {
    const night = c.req.param('night');
    let digest;
    try {
      digest = await readNight(config.runsDir, night);
    } catch (error) {
      if (error instanceof RangeError) return c.text('night not found', 404);
      throw error;
    }
    if (!digest.found) return c.text('night not found', 404);
    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });

  registerDigestJsonRoutes(app, config);

  return app;
}
