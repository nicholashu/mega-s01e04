import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow } from '../src/digest/types.js';

// Route contract for GET /digest/:night and GET /api/digest/:night (plan.md § 2a-2b · issue #5).
// Runs against createApp(config).request() with temp runs dirs; runs/ is never touched.

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const night = '2026-10-28';

async function nightOnDisk(lines: unknown[] | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'digest-routes-'));
  dirs.push(dir);
  const contents = typeof lines === 'string' ? lines : lines.map((line) => JSON.stringify(line)).join('\n');
  await writeFile(join(dir, `${night}.jsonl`), contents);
  return dir;
}

const app = (runsDir: string) =>
  createApp({
    adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir,
  } satisfies RigConfig);

const event = (over: Record<string, unknown> = {}) => ({
  at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...over,
});

// Deliberately unsorted: not by job, not by instant, mixed offsets. Later events come first,
// the last alpha event carries owner null after an earlier owned one, and its error survives
// the successful recovery.
const unsortedNight = [
  { at: '2026-10-29T23:30:00+02:00', job: 'alpha/render', status: 'ok', owner: null },
  { at: '2026-10-29T01:30:00+01:00', job: 'alpha/render', status: 'retry', owner: 'rook', error: 'upstream 503' },
  { at: '2026-10-28T18:00:00-07:00', job: 'zeta/hook', status: 'fail', owner: null, error: 'disk full' },
];

describe('digest routes', () => {
  it('serves the JSON envelope for an unsorted, mixed-offset night', async () => {
    const runsDir = await nightOnDisk(unsortedNight);
    const res = await app(runsDir).request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      night, found: true, badLines: 0,
      rows: [
        { job: 'alpha/render', owner: null, runs: 2, retries: 1, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T23:30:00+02:00' },
        { job: 'zeta/hook', owner: null, runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full',
          firstAt: '2026-10-28T18:00:00-07:00', lastAt: '2026-10-28T18:00:00-07:00' },
      ],
    });
  });

  it('renders the page in the same job order as the JSON, offsets preserved, nulls as em dashes', async () => {
    const runsDir = await nightOnDisk(unsortedNight);
    const digest = app(runsDir);
    const jsonRes = await digest.request(`/api/digest/${night}`);
    const pageRes = await digest.request(`/digest/${night}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    const rows = ((await jsonRes.json()) as { rows: DigestRow[] }).rows;
    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => row.job);
    expect(html.indexOf(first)).toBeGreaterThan(-1);
    expect(html.indexOf(first)).toBeLessThan(html.indexOf(second));
    expect(html).toContain('2026-10-29T23:30:00+02:00');
    expect(html).toContain('2026-10-28T18:00:00-07:00');
    expect(html).toContain('—');
  });

  it('404s a night with no file on both routes, the JSON one as a JSON error', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'digest-routes-'));
    dirs.push(runsDir);
    const digest = app(runsDir);
    expect((await digest.request(`/digest/${night}`)).status).toBe(404);
    const apiRes = await digest.request(`/api/digest/${night}`);
    expect(apiRes.status).toBe(404);
    expect(apiRes.headers.get('content-type')).toContain('application/json');
  });

  it('404s an invalid night date on both routes', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'digest-routes-'));
    dirs.push(runsDir);
    const digest = app(runsDir);
    expect((await digest.request(`/digest/2026-02-30`)).status).toBe(404);
    expect((await digest.request(`/api/digest/2026-02-30`)).status).toBe(404);
  });

  it('serves an empty night as found, with "nothing ran"', async () => {
    const runsDir = await nightOnDisk('');
    const apiRes = await app(runsDir).request(`/api/digest/${night}`);
    expect(await apiRes.json()).toEqual({ night, found: true, rows: [], badLines: 0 });
    const pageRes = await app(runsDir).request(`/digest/${night}`);
    expect(pageRes.status).toBe(200);
    expect(await pageRes.text()).toContain('nothing ran');
  });

  it('counts a malformed line on both routes and still serves the valid rows', async () => {
    const runsDir = await nightOnDisk(`{broken\n${JSON.stringify(event({ job: 'ok/job' }))}`);
    const apiRes = await app(runsDir).request(`/api/digest/${night}`);
    expect(await apiRes.json()).toEqual({
      night, found: true, badLines: 1,
      rows: [{ job: 'ok/job', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
               firstAt: '2026-10-29T01:00:00+01:00', lastAt: '2026-10-29T01:00:00+01:00' }],
    });
    const pageRes = await app(runsDir).request(`/digest/${night}`);
    expect(pageRes.status).toBe(200);
    expect(await pageRes.text()).toContain('malformed');
  });

  it('warn-marks retries at the threshold of three and a failed status, not below it', async () => {
    const runsDir = await nightOnDisk([
      event({ job: 'a/below', status: 'retry' }),
      event({ job: 'a/below', status: 'retry' }),
      event({ job: 'a/below' }),
      event({ job: 'b/at', status: 'retry' }),
      event({ job: 'b/at', status: 'retry' }),
      event({ job: 'b/at', status: 'retry' }),
      event({ job: 'b/at' }),
      event({ job: 'c/fail', status: 'fail', error: 'disk full' }),
    ]);
    const html = await (await app(runsDir).request(`/digest/${night}`)).text();
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).not.toContain('<td class="warn">2</td>');
    expect(html).toContain('<td class="warn">fail</td>');
  });

  it('keeps HTML in job, owner and error text inert in the page but whole in the JSON', async () => {
    const runsDir = await nightOnDisk([
      event({ job: 'weird/job<b>', owner: '<b>rook</b>', error: '<script>alert(1)</script>' }),
    ]);
    const digest = app(runsDir);
    const html = await (await digest.request(`/digest/${night}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;rook&lt;/b&gt;');
    const rows = ((await (await digest.request(`/api/digest/${night}`)).json()) as { rows: DigestRow[] }).rows;
    expect(rows[0]).toMatchObject({ job: 'weird/job<b>', owner: '<b>rook</b>', lastError: '<script>alert(1)</script>' });
  });
});
