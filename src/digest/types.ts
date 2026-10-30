export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner on the latest event, including an explicit null. */
  owner: string | null;
  /** All valid events for this job, including retries. */
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  /** Most recent reported error, retained after a successful recovery. */
  lastError: string | null;
  /** Earliest/latest instants, with the log's original timestamp strings. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** False only for an absent file/directory; empty files are found. */
  found: boolean;
  /** One row per job, sorted by job using code point order. */
  rows: DigestRow[];
  /** Nonblank lines with invalid JSON or invalid event fields. */
  badLines: number;
};

/**
 * Read runsDir/<night>.jsonl. Night must be a valid YYYY-MM-DD date.
 * Invalid dates and paths escaping runsDir reject with RangeError; other I/O
 * failures propagate. Blank lines are ignored. Equal timestamps use file order
 * (the later line wins). Missing and empty nights both have no rows/bad lines.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest>;
