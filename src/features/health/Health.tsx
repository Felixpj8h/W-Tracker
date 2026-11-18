import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api/client';
import { HealthIcon, HealthWidgets } from './HealthWidgets';
import type { HealthOverview } from './types';
import './health.css';

export function healthToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function recoveryPrompt(overview: HealthOverview) {
  return 'Review my recovery and suggest how I should approach training today. Give advice only; do not create, change or apply a training plan. Treat wearable metrics as estimates, consider dates and missing readings, and compare HRV and resting heart rate only with my own available history. Do not diagnose or invent a readiness score. My Google Health summary (null means unavailable):\n' + JSON.stringify({ synced_at: overview.fetched_at, days: overview.data?.days, warnings: overview.data?.warnings });
}

const fetchSync = () => api<HealthOverview>('/health/sync', { method: 'POST', body: JSON.stringify({ today: healthToday() }) });

function ConnectionStatus({ overview, busy, connect, disconnect }: {
  overview: HealthOverview; busy: boolean; connect: () => void; disconnect: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const synced = overview.fetched_at ? new Date(overview.fetched_at * 1000) : null;
  const sameDay = synced && healthToday(synced) === healthToday();
  const stale = synced && Date.now() - synced.getTime() > 3600000;

  return <div className="health-status">
    <button type="button" className="health-connection" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">
      <i />Google Health<HealthIcon name="connection" />
    </button>
    <small className={stale ? 'health-stale' : undefined} title={synced?.toLocaleString()}>
      {synced ? <>{stale ? 'Last sync' : 'Synced'} <time dateTime={synced.toISOString()}>{sameDay
        ? synced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : synced.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></>
        : 'Ready for first sync'}
    </small>
    <dialog ref={dialog} className="health-dialog" aria-labelledby="health-connection-title">
      <div className="health-dialog-heading">
        <h2 id="health-connection-title">Google Health connection</h2>
        <button type="button" className="secondary" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      {overview.account_email && <p className="health-muted">{overview.account_email}</p>}
      <dl className="health-permissions">{(['activity', 'sleep', 'recovery'] as const).map(permission =>
        <div key={permission}><dt>{permission}</dt><dd>{overview.permissions[permission] ? 'Allowed' : 'Not granted'}</dd></div>)}</dl>
      <p className="health-muted">Sync your wearable with Google Health first to bring its latest readings into Jern.</p>
      <div className="health-actions">
        <button type="button" className="secondary" disabled={busy} onClick={connect}>Update permissions</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => {
          if (window.confirm('Disconnect Google Health and remove imported health data from Jern? Health summaries already shared in coach conversations remain in those conversations.')) {
            dialog.current?.close();
            disconnect();
          }
        }}>Disconnect & remove data</button>
      </div>
    </dialog>
  </div>;
}

export function Health({ askCoach }: { askCoach: (prompt: string) => Promise<void> }) {
  const [overview, setOverview] = useState<HealthOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState(8000);
  const [notice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('health');
    if (outcome) {
      params.delete('health');
      window.history.replaceState(null, '', `${window.location.pathname}${params.size ? '?' + params : ''}#health`);
    }
    if (outcome === 'failed') return 'Connection failed. Use your Jern Google account, check API access and try again.';
    return outcome === 'cancelled' ? 'Connection cancelled.' : '';
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api<HealthOverview>('/health/overview');
        if (!active) return;
        setOverview(result);
        setGoal(result.step_goal);
        setLoading(false);
        if (result.connected && (!result.fetched_at || Date.now() / 1000 - result.fetched_at > 300)) {
          setBusy(true);
          const synced = await fetchSync();
          if (active) setOverview(synced);
        }
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) {
          setLoading(false);
          setBusy(false);
        }
      }
    })();
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const connect = () => void run(async () => {
    const result = await api<{ url: string }>('/health/google/connect', { method: 'POST' });
    window.location.assign(result.url);
  });
  const sync = () => void run(async () => setOverview(await fetchSync()));
  const disconnect = () => void run(async () => {
    await api('/health/google', { method: 'DELETE' });
    setOverview(await api<HealthOverview>('/health/overview'));
  });
  const saveGoal = () => void run(async () => {
    const updated = await api<HealthOverview>('/health/goal', { method: 'PATCH', body: JSON.stringify({ step_goal: goal }) });
    setOverview(updated);
    setGoal(updated.step_goal);
  });
  const warnings = Object.keys(overview?.data?.warnings ?? {});

  return <section className={`health-page${overview?.connected ? ' health-connected' : ''}`} aria-busy={busy || loading}>
    <header className={overview?.connected ? 'health-header' : 'health-setup-header'}>
      <div>
        <h1>Health</h1>
        {overview?.connected && <ConnectionStatus overview={overview} busy={busy} connect={connect} disconnect={disconnect} />}
      </div>
      {overview?.connected && <button className="secondary" disabled={busy} onClick={sync}><HealthIcon name="sync" />{busy ? 'Syncing…' : 'Sync now'}</button>}
    </header>
    {notice && <p className="health-notice" role="status">{notice}</p>}
    {error && <div className="health-notice" role="alert">
      <span>{error}</span>
      <button className="secondary" onClick={() => overview?.connected ? sync() : window.location.reload()} disabled={busy}>Retry</button>
    </div>}
    {loading && <p className="health-muted" role="status">Loading your health overview.</p>}
    {!loading && overview && !overview.connected && <article className="health-connect card">
      <div className="health-connect-heading"><span className="health-emblem"><HealthIcon name="recovery" /></span><div><h2>Google Health</h2><p>Steps · Activity · Sleep · Recovery</p></div></div>
      {!overview.configured && <p className="health-setup-status">Connection not configured yet.</p>}
      <button className="primary" disabled={busy || !overview.configured} onClick={connect}>Connect Google Health</button>
    </article>}
    {overview?.connected && <>
      {warnings.length > 0 && <p className="health-notice" role="status">Couldn’t sync {warnings.join(', ').replaceAll('_', ' ')}. Sync again or check permissions.</p>}
      <HealthWidgets overview={overview} today={healthToday()} goal={goal} setGoal={setGoal} saveGoal={saveGoal} busy={busy} askRecovery={() => void run(() => askCoach(recoveryPrompt(overview)))} />
    </>}
  </section>;
}
