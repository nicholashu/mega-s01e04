import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Run = { at: string; job: string; status: RunStatus; owner: string | null; error?: string };

export function validNight(night: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(night)
    && Number.isFinite(Date.parse(night))
    && new Date(night).toISOString().slice(0, 10) === night;
}

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return typeof run.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(run.at)
    && validNight(run.at.slice(0, 10))
    && Number.isFinite(Date.parse(run.at))
    && Number(run.at.slice(11, 13)) < 24
    && typeof run.job === 'string' && run.job.trim().length > 0
    && (run.status === 'ok' || run.status === 'retry' || run.status === 'fail')
    && (run.owner === null || typeof run.owner === 'string')
    && (run.error === undefined || typeof run.error === 'string');
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export const readNight: ReadNight = async (runsDir, night) => {
  if (!validNight(night)) throw new RangeError('Night must be a valid YYYY-MM-DD date');
  const result = { night, found: true, rows: [] as DigestRow[], badLines: 0 };
  let contents: string;
  try {
    const root = await realpath(runsDir);
    const file = await realpath(resolve(root, `${night}.jsonl`));
    const pathFromRoot = relative(root, file);
    if (isAbsolute(pathFromRoot) || pathFromRoot === '..' || pathFromRoot.startsWith('../')) {
      throw new RangeError('Night file must stay inside runsDir');
    }
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;
    return { ...result, found: false };
  }

  const jobs = new Map<string, { row: DigestRow; errorAt: number }>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      result.badLines++;
      continue;
    }
    if (!isRun(value)) {
      result.badLines++;
      continue;
    }
    const run = value;
    const at = Date.parse(run.at);
    const existing = jobs.get(run.job);
    if (!existing) {
      jobs.set(run.job, {
        row: {
          job: run.job, owner: run.owner, runs: 1, retries: Number(run.status === 'retry'),
          lastStatus: run.status, lastError: run.error ?? null, firstAt: run.at, lastAt: run.at,
        },
        errorAt: run.error === undefined ? -Infinity : at,
      });
      continue;
    }
    const { row } = existing;
    row.runs++;
    if (run.status === 'retry') row.retries++;
    if (at < Date.parse(row.firstAt)) row.firstAt = run.at;
    if (at >= Date.parse(row.lastAt)) {
      row.lastAt = run.at;
      row.lastStatus = run.status;
      row.owner = run.owner;
    }
    if (run.error !== undefined && at >= existing.errorAt) {
      row.lastError = run.error;
      existing.errorAt = at;
    }
  }
  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
};
