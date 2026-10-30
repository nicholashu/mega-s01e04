import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'digest-reader-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

const night = '2026-10-28';
const event = (overrides: Record<string, unknown> = {}) => ({
  at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook', ...overrides,
});
async function fixture(lines: unknown[]) {
  const dir = await tempDir();
  await writeFile(join(dir, `${night}.jsonl`), lines.map(line => JSON.stringify(line)).join('\n'));
  return dir;
}

describe('night reader', () => {
  it('counts fractions beyond millisecond precision as bad lines', async () => {
    const dir = await fixture([
      event({ job: 'too-precise', at: '2026-10-29T01:00:00.0009Z' }),
      event({ job: 'too-precise', at: '2026-10-29T01:00:00.0001Z', status: 'fail' }),
      event({ at: '2026-10-29T01:00:00.123Z' }),
      event({ at: '2026-10-29T01:00:00.1Z' }),
      event({ at: '2026-10-29T01:00:00.12Z', status: 'retry' }),
    ]);
    expect(await readNight(dir, night)).toMatchObject({
      badLines: 2,
      rows: [{ job: 'job', runs: 3, retries: 1, lastStatus: 'ok',
        firstAt: '2026-10-29T01:00:00.1Z', lastAt: '2026-10-29T01:00:00.123Z' }],
    });
  });

  it('aggregates the real night without modifying its bytes', async () => {
    const runsDir = new URL('../runs/', import.meta.url).pathname;
    const file = join(runsDir, `${night}.jsonl`);
    const before = await readFile(file);
    const digest = await readNight(runsDir, night);
    expect({ found: digest.found, badLines: digest.badLines, jobs: digest.rows.map(row => row.job) }).toEqual({
      found: true, badLines: 1,
      jobs: ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'],
    });
    expect(digest.rows).toEqual([
      { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
      { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
      { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
      { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
      { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
    ]);
    expect(await readFile(file)).toEqual(before);
  });

  it('uses chronological instants across offsets and retains the latest error after recovery', async () => {
    const dir = await fixture([
      event({ at: '2026-10-29T02:00:00+01:00', status: 'fail', error: 'latest' }),
      event({ at: '2026-10-29T02:30:00+02:00', status: 'retry', error: 'older' }),
      event({ at: '2026-10-28T23:00:00-03:00', owner: null }),
    ]);
    expect((await readNight(dir, night)).rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest',
      firstAt: '2026-10-29T02:30:00+02:00', lastAt: '2026-10-28T23:00:00-03:00',
    }]);
  });

  it('breaks timestamp ties by file order and safely aggregates special job names', async () => {
    const dir = await fixture([
      event({ job: '__proto__', status: 'retry', error: 'first' }),
      event({ job: '__proto__', status: 'fail', owner: null, error: 'second' }),
      event({ job: 'Z' }), event({ job: 'a' }),
    ]);
    const { rows } = await readNight(dir, night);
    expect(rows.map(row => row.job)).toEqual(['Z', '__proto__', 'a']);
    expect(rows[1]).toMatchObject({ runs: 2, retries: 1, lastStatus: 'fail', owner: null, lastError: 'second' });
  });

  it('counts malformed JSON and invalid events individually, skips blanks, and continues', async () => {
    const dir = await fixture([
      null, [], 42, event({ job: '' }), event({ status: 'pending' }),
      event({ owner: undefined }), event({ error: 12 }), event({ at: 'yesterday' }),
      event({ at: '2026-02-30T01:00:00Z' }), event({ at: '2026-10-29T24:00:00Z' }),
      event({ at: '2026-10-29T01:00:00' }), event(),
    ]);
    const file = join(dir, `${night}.jsonl`);
    await writeFile(file, `\r\n  \r\n{broken\r\n${await readFile(file, 'utf8')}\r\n${JSON.stringify(event({ owner: null }))}\r\n`);
    const digest = await readNight(dir, night);
    expect(digest.badLines).toBe(12);
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ owner: null, runs: 2 });
  });

  it('distinguishes missing, empty, and entirely malformed nights', async () => {
    const dir = await tempDir();
    expect(await readNight(dir, night)).toEqual({ night, found: false, rows: [], badLines: 0 });
    expect((await readNight(join(dir, 'absent'), night)).found).toBe(false);
    const file = join(dir, `${night}.jsonl`);
    await writeFile(file, '\n  \n');
    expect(await readNight(dir, night)).toEqual({ night, found: true, rows: [], badLines: 0 });
    await writeFile(file, '{truncated');
    expect(await readNight(dir, night)).toEqual({ night, found: true, rows: [], badLines: 1 });
  });

  it('rejects traversal and invalid dates before reading a file', async () => {
    const dir = await tempDir();
    for (const invalid of ['../2026-10-28', '/2026-10-28', '2026-02-30', '2026-1-01', '2026-10-28/..']) {
      await expect(readNight(dir, invalid)).rejects.toThrow(RangeError);
    }
  });

  it('rejects a night symlink escaping the runs directory', async () => {
    const dir = await tempDir();
    const outside = await fixture([event()]);
    await symlink(join(outside, `${night}.jsonl`), join(dir, `${night}.jsonl`));
    await expect(readNight(dir, night)).rejects.toThrow(RangeError);
  });

  it('propagates filesystem failures instead of reporting them as missing nights', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, `${night}.jsonl`));
    await expect(readNight(dir, night)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
