import type { NightDigest } from '../digest/types.js';

const RETRY_WARN_AT = 3;

export function DigestPage({ digest }: { digest: NightDigest }) {
  const malformed = digest.badLines === 1 ? '1 malformed line skipped' : `${digest.badLines} malformed lines skipped`;

  return (
    <>
      <h1>digest</h1>
      <p class="mute">{digest.night}</p>
      {digest.badLines > 0 ? <p class="warn">{malformed}</p> : null}
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>status</th>
              <th>error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner ?? '—'}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= RETRY_WARN_AT ? 'warn' : undefined}>{row.retries}</td>
                <td class={row.lastStatus === 'fail' ? 'warn' : undefined}>{row.lastStatus}</td>
                <td>{row.lastError ?? '—'}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
