import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { api } from '../../shared/api/client';
import { HealthIcon, HealthWidgets } from './HealthWidgets';
import type { HealthOverview } from './types';
import './health.css';

export function healthToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const fetchSync = () => api<HealthOverview>('/health/sync', { method: 'POST', body: JSON.stringify({ today: healthToday() }) });

const coachTopics = [
  { id: 'sleep', label: 'Sleep', permission: 'sleep', fields: ['sleep_minutes'] },
  { id: 'activity', label: 'Activity', permission: 'activity', fields: ['active_minutes'] },
  { id: 'steps', label: 'Steps', permission: 'activity', fields: ['steps'] },
  { id: 'recovery', label: 'Recovery', permission: 'recovery', fields: ['hrv', 'resting_hr'] },
] as const;
type CoachTopic = (typeof coachTopics)[number];

function isCoachBackdrop(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
  return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
}

function HealthCoach({ overview, askCoach }: { overview: HealthOverview; askCoach: (prompt: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const [selected, setSelected] = useState<CoachTopic['id'] | null>(null);
  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const days = overview.data?.days.slice(-7) ?? [];
  const unavailable = (topic: CoachTopic) => !overview.permissions[topic.permission] ? 'Permission required'
    : days.some(day => topic.fields.some(field => day[field] != null)) ? null : 'No recent readings';
  const topic = coachTopics.find(item => item.id === selected);

  async function send() {
    if (sending || !topic || unavailable(topic)) return;
    setSending(true);
    setError('');
    const summary = {
      ...(topic.id === 'steps' ? { daily_step_goal: overview.step_goal } : {}),
      days: days.map(day => ({ date: day.date, ...Object.fromEntries(topic.fields.map(field => [field, day[field]])) })),
    };
    const question = prompt.trim() || `Review my recent ${topic.id} and suggest one or two practical next steps.`;
    const context = 'Give advice only. Do not create, change or apply a plan, diagnose, or invent readings. Use my own history for comparisons.';
    try {
      await askCoach(`${question}\n\n${context}\nMy Google Health summary (null means unavailable):\n${JSON.stringify(summary)}`);
      dialog.current?.close();
    } catch (err) {
      setError((err as Error).message || 'Could not open the coach. Try again.');
    } finally {
      setSending(false);
    }
  }

  return <>
    <button type="button" className="secondary" aria-haspopup="dialog" onClick={() => {
      setSelected(null);
      setPrompt('');
      setError('');
      pressedBackdrop.current = false;
      dialog.current?.showModal();
    }}><HealthIcon name="coach" />Ask coach</button>
    <dialog ref={dialog} className="health-dialog health-coach-dialog" aria-labelledby="health-coach-title"
      onPointerDown={event => { pressedBackdrop.current = isCoachBackdrop(event); }}
      onClick={event => {
        if (!sending && pressedBackdrop.current && isCoachBackdrop(event)) event.currentTarget.close();
        pressedBackdrop.current = false;
      }}
      onCancel={event => { if (sending) event.preventDefault(); }}>
      <div className="health-dialog-heading"><h2 id="health-coach-title">Ask coach</h2></div>
      <form onSubmit={event => { event.preventDefault(); void send(); }}>
        <fieldset className="health-coach-topics" disabled={sending}>
          <legend>What would you like to ask about?</legend>
          {coachTopics.map(item => {
            const reason = unavailable(item);
            return <label key={item.id}>
              <input type="radio" name="health-coach-topic" value={item.id} checked={selected === item.id}
                disabled={Boolean(reason)} onChange={() => setSelected(item.id)} />
              <HealthIcon name={item.id} />
              <span>{item.label}{reason && <small>{reason}</small>}</span>
            </label>;
          })}
        </fieldset>
        <label className="health-coach-question">
          <span>Your question <small>(optional)</small></span>
          <textarea rows={3} maxLength={3000} value={prompt} disabled={sending}
            placeholder="What patterns do you notice, and what could I improve?"
            onChange={event => setPrompt(event.target.value)} />
        </label>
        <p className="health-muted">Shares up to 7 days of readings for the selected topic in a new coach conversation.</p>
        {error && <p className="health-muted" role="alert">{error}</p>}
        <div className="health-actions health-coach-actions">
          <button type="button" className="secondary" disabled={sending} onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="primary" disabled={sending || !topic || Boolean(unavailable(topic))}>{sending ? 'Opening coach…' : 'Send to coach'}</button>
        </div>
      </form>
    </dialog>
  </>;
}

function ConnectionStatus({ overview, busy, connect, disconnect }: {
  overview: HealthOverview; busy: boolean; connect: () => void; disconnect: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const synced = overview.fetched_at ? new Date(overview.fetched_at * 1000) : null;
  const sameDay = synced && healthToday(synced) === healthToday();
  const stale = synced && Date.now() - synced.getTime() > 3600000;

  return <div className="health-status">
    <button type="button" className="health-connection" onClick={() => dialog.current?.showModal()} aria-haspopup="dialog">
      <span className="health-provider"><i />Google Health<HealthIcon name="connection" /></span>
      <small className={stale ? 'health-stale' : undefined} title={synced?.toLocaleString()}>
      {synced ? <>{stale ? 'Last sync' : 'Synced'} <time dateTime={synced.toISOString()}>{sameDay
        ? synced.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : synced.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></>
        : 'Ready for first sync'}
      </small>
    </button>
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
  const [today, setToday] = useState(healthToday);
  const syncedDay = useRef(today);
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
    let timer: number;
    function checkDate() {
      window.clearTimeout(timer);
      const now = new Date();
      setToday(healthToday(now));
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      timer = window.setTimeout(checkDate, midnight.getTime() - now.getTime());
    }
    checkDate();
    document.addEventListener('visibilitychange', checkDate);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkDate);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api<HealthOverview>('/health/overview');
        if (!active) return;
        setOverview(result);
        setGoal(result.step_goal);
        setLoading(false);
        if (result.connected && (!result.fetched_at || Date.now() / 1000 - result.fetched_at > 300 ||
            healthToday(new Date(result.fetched_at * 1000)) !== healthToday())) {
          setBusy(true);
          syncedDay.current = healthToday();
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

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const sync = useCallback(() => {
    syncedDay.current = healthToday();
    void run(async () => setOverview(await fetchSync()));
  }, [run]);
  const connected = overview?.connected;
  useEffect(() => {
    if (connected && !busy && !loading && syncedDay.current !== today) sync();
  }, [busy, connected, loading, sync, today]);

  const connect = () => void run(async () => {
    const result = await api<{ url: string }>('/health/google/connect', { method: 'POST' });
    window.location.assign(result.url);
  });
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
      <div className="health-heading">
        <h1>Health</h1>
        {overview?.connected && <ConnectionStatus overview={overview} busy={busy} connect={connect} disconnect={disconnect} />}
      </div>
      {overview?.connected && <div className="health-header-actions">
        <HealthCoach overview={overview} askCoach={askCoach} />
        <button className="secondary" disabled={busy} onClick={sync}><HealthIcon name="sync" />{busy ? 'Syncing…' : 'Sync now'}</button>
      </div>}
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
      <HealthWidgets overview={overview} today={today} goal={goal} setGoal={setGoal} saveGoal={saveGoal} busy={busy} />
    </>}
  </section>;
}
