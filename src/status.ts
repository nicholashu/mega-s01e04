import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { DigestRow } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightCounts = {
  /** Jobs whose last event had this status. The three counts sum to the night's rows. */
  ok: number;
  retry: number;
  fail: number;
};

export type NightOnDisk = {
  night: string;
  /** Final status per job, not raw event counts. */
  counts: NightCounts;
  /** Retry events across all jobs, kept separately as the transient-retry signal. */
  retryAttempts: number;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightOnDisk[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      return [];
    }
    throw error;
  }
}

export function countJobs(rows: DigestRow[]): NightCounts {
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const row of rows) counts[row.lastStatus]++;
  return counts;
}

export function countRetryAttempts(rows: DigestRow[]): number {
  return rows.reduce((total, row) => total + row.retries, 0);
}

export async function readStatus(config: RigConfig): Promise<Status> {
  const digests = await Promise.all(
    nightsOnDisk(config.runsDir).map((night) => readNight(config.runsDir, night)),
  );
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    // A file removed between listing and reading is no longer on disk; don't report a false zero.
    nights: digests
      .filter((digest) => digest.found)
      .map((digest) => ({
        night: digest.night,
        counts: countJobs(digest.rows),
        retryAttempts: countRetryAttempts(digest.rows),
      })),
  };
}
