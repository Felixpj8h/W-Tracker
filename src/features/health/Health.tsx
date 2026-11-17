import { useEffect, useState } from 'react';
import { api } from '../../shared/api/client';
import { PageHeader } from '../../shared/ui/PageHeader';
import type { HealthDay, HealthOverview, Sleep } from './types';
import './health.css';

const count = (v: number | null | undefined) => v == null ? '—' : Math.round(v).toLocaleString();
const duration = (v: number | null | undefined) => v == null ? '—' : `${Math.floor(v / 60)}h ${Math.round(v % 60)}m`;
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const timeLabel = (date: string | null) => date ? new Date(date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';
const stageColors: Record<string, string> = { DEEP: '#7668ce', LIGHT: '#aaa0e8', REM: '#78b7d6', AWAKE: '#e9b174', ASLEEP: '#aaa0e8', RESTLESS: '#c9bd99' };
export const healthToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const today = healthToday;

function Trend({ days, field, label, format = count }: { days: HealthDay[]; field: keyof Omit<HealthDay, 'date'>; label: string; format?: (v: number | null) => string }) {
  const max = Math.max(1, ...days.map(day => day[field] ?? 0));
  return <div className="health-trend" role="img" aria-label={`${label}: ${days.map(day => `${dateLabel(day.date)} ${format(day[field])}`).join(', ')}`}>
    {days.map(day => <div key={day.date} title={`${dateLabel(day.date)}: ${format(day[field])}`}>
      <span>{format(day[field])}</span><div className="health-trend-track"><i style={{ height: `${day[field] == null ? 0 : Math.max(2, day[field]! / max * 100)}%` }} /></div>
      <small>{new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small>
    </div>)}
  </div>;
}

function SleepStages({ sleep }: { sleep: Sleep }) {
  if (!sleep.stages.length || !sleep.start || !sleep.end) return <p className="health-muted">Sleep stages are not available for this session.</p>;
  const start = Date.parse(sleep.start), span = Date.parse(sleep.end) - start;
  if (!(span > 0)) return null;
  return <>
    <div className="health-stage-track" aria-label="Sleep stage timeline" role="img">
      {sleep.stages.map((stage, index) => {
        const left = Math.max(0, (Date.parse(stage.start) - start) / span * 100);
        const width = Math.min(100 - left, (Date.parse(stage.end) - Date.parse(stage.start)) / span * 100);
        return <i key={index} title={`${stage.type}: ${timeLabel(stage.start)}–${timeLabel(stage.end)}`} style={{ left: `${left}%`, width: `${width}%`, background: stageColors[stage.type] ?? 'var(--muted)' }} />;
      })}
    </div>
    <div className="health-sleep-times"><span>{timeLabel(sleep.start)}</span><span>{timeLabel(sleep.end)}</span></div>
    <div className="health-stage-key">{Object.entries(stageColors).filter(([type]) => sleep.stages.some(stage => stage.type === type)).map(([type, color]) => <span key={type}><i style={{ background: color }} />{type.toLowerCase()}</span>)}</div>
    <details className="health-stage-list"><summary>Stage intervals</summary><ul>{sleep.stages.map((stage, i) => <li key={i}>{stage.type.toLowerCase()} · {timeLabel(stage.start)}–{timeLabel(stage.end)}</li>)}</ul></details>
  </>;
}

export function recoveryPrompt(overview: HealthOverview) {
  return 'Review my recovery and suggest how I should approach training today. Give advice only; do not create, change or apply a training plan. Treat wearable metrics as estimates, consider dates and missing readings, and compare HRV and resting heart rate only with my own available history. Do not diagnose or invent a readiness score. My Google Health summary (null means unavailable):\n' + JSON.stringify({ synced_at: overview.fetched_at, days: overview.data?.days, warnings: overview.data?.warnings });
}

export function Health({ askCoach }: { askCoach: (prompt: string) => Promise<void> }) {
  const [overview, setOverview] = useState<HealthOverview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState(8000);
  const [notice] = useState(() => {
    const params = new URLSearchParams(window.location.search), outcome = params.get('health');
    if (outcome) { params.delete('health'); window.history.replaceState(null, '', `${window.location.pathname}${params.size ? '?' + params : ''}#health`); }
    return outcome === 'failed' ? 'Connection failed. Use your Jern Google account, check API access and try again.' : outcome === 'cancelled' ? 'Connection cancelled. You can connect whenever you are ready.' : '';
  });
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api<HealthOverview>('/health/overview');
        if (!active) return;
        setOverview(result); setGoal(result.step_goal); setLoading(false);
        if (result.connected && (!result.fetched_at || Date.now() / 1000 - result.fetched_at > 300)) {
          setBusy(true);
          const synced = await api<HealthOverview>('/health/sync', { method: 'POST', body: JSON.stringify({ today: today() }) });
          if (active) setOverview(synced);
        }
      } catch (err) { if (active) setError((err as Error).message); }
      finally { if (active) { setLoading(false); setBusy(false); } }
    })();
    return () => { active = false; };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  const connect = () => run(async () => { const result = await api<{ url: string }>('/health/google/connect', { method: 'POST' }); window.location.assign(result.url); });
  const sync = () => run(async () => { setOverview(await api<HealthOverview>('/health/sync', { method: 'POST', body: JSON.stringify({ today: today() }) })); });
  const days = overview?.data?.days ?? [], current = days.find(day => day.date === today());
  const sleep = overview?.data?.sleep;
  const latestHrv = days.filter(day => day.hrv != null).at(-1), latestHr = days.filter(day => day.resting_hr != null).at(-1);
  const hrvHistory = days.filter(day => day.hrv != null && day.date !== latestHrv?.date);
  const hrHistory = days.filter(day => day.resting_hr != null && day.date !== latestHr?.date);
  const average = (items: HealthDay[], field: 'hrv' | 'resting_hr') => items.length >= 3 ? items.reduce((sum, day) => sum + (day[field] ?? 0), 0) / items.length : null;
  const warnings = overview?.data?.warnings ?? {};
  const hasRecovery = days.some(day => day.hrv != null || day.resting_hr != null || day.sleep_minutes != null);
  return <section className="health-page" aria-busy={busy || loading}>
    {overview?.connected ? <PageHeader action={<button className="secondary" disabled={busy} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync now'}</button>}>
      <p className="overline">YOUR DAILY PICTURE</p><h1>Health</h1><p>Movement, sleep and recovery. Together.</p>
    </PageHeader> : <header className="health-setup-header"><h1>Health</h1></header>}
    {notice && <p className="health-notice" role="status">{notice}</p>}
    {error && <div className="health-notice" role="alert">{error} <button onClick={() => overview?.connected ? void sync() : window.location.reload()} disabled={busy}>Retry</button></div>}
    {loading && <p role="status">Loading your health overview…</p>}
    {!loading && overview && !overview.connected && <article className="health-connect card">
      <div className="health-connect-heading"><span className="health-emblem" aria-hidden="true">♡</span><div><h2>Google Health</h2><p>Steps · Activity · Sleep · Recovery</p></div></div>
      {!overview.configured && <p className="health-setup-status">Connection not configured yet.</p>}
      <button className="primary" disabled={busy || !overview.configured} onClick={() => void connect()}>Connect Google Health</button>
    </article>}
    {overview?.connected && <>
      <div className="health-status"><span><i /> Google Health · {overview.account_email}</span><small>{overview.fetched_at ? `Fetched ${new Date(overview.fetched_at * 1000).toLocaleString()}` : 'Ready for your first sync'}</small></div>
      {Object.keys(warnings).length > 0 && <p className="health-notice" role="status">Some metrics could not sync: {Object.keys(warnings).join(', ').replaceAll('_', ' ')}. Missing readings are shown as —. Try syncing again or reconnecting.</p>}
      {overview.fetched_at && Date.now() / 1000 - overview.fetched_at > 3600 ? <p className="health-notice">Showing previously fetched data. Sync for a more recent view.</p> : null}
      <div className="health-grid">
        <article className="card health-steps"><p className="overline">TODAY · {dateLabel(today())}</p><h2>Keep moving</h2>
          <div className="health-step-value">{count(current?.steps)}<span>steps</span></div>
          <progress max={overview.step_goal} value={current?.steps ?? 0} aria-label="Daily step goal progress" />
          <p className="health-muted">{current?.steps != null ? `${Math.round(current.steps / overview.step_goal * 100)}% of your ${count(overview.step_goal)} step goal` : overview.permissions.activity ? 'No steps recorded for today yet.' : 'Grant activity access to see your steps.'}</p>
          <details><summary>Seven-day steps & goal</summary><Trend days={days} field="steps" label="Daily steps" />
            <form className="health-goal" onSubmit={event => { event.preventDefault(); void run(async () => setOverview(await api<HealthOverview>('/health/goal', { method: 'PATCH', body: JSON.stringify({ step_goal: goal }) }))); }}>
              <label>Daily step goal<input type="number" min="1000" max="100000" step="100" value={goal} onChange={event => setGoal(Number(event.target.value))} /></label><button className="secondary" disabled={busy}>Save goal</button>
            </form><p className="health-muted">Your personal goal in Jern.</p>
          </details>
        </article>
        <article className="card health-activity"><p className="overline">ACTIVITY</p><h2>Every bit counts</h2>
          <div className="health-step-value">{count(current?.active_minutes)}<span>active min today</span></div>
          <p className="health-muted">Light, moderate and vigorous movement.</p>
          <details><summary>Training & seven-day activity</summary><Trend days={days} field="active_minutes" label="Active minutes" />
            <h3>Recorded activities</h3>{overview.data?.workouts.length ? <ul className="health-workouts">{overview.data.workouts.map((workout, i) => <li key={i}><span>{workout.type.toLowerCase().replaceAll('_', ' ')}<small>{dateLabel(workout.date)}</small></span><b>{Math.round(workout.minutes)} min</b></li>)}</ul> : <p className="health-muted">No recorded activities in the last seven days.</p>}
          </details>
        </article>
        <article className="card health-sleep"><p className="overline">{sleep ? `SLEEP · WOKE ${dateLabel(sleep.date)}` : 'SLEEP'}</p><h2>Make room for rest</h2>
          <div className="health-step-value">{duration(sleep?.minutes)}<span>asleep</span></div>
          {sleep ? <SleepStages sleep={sleep} /> : <p className="health-muted">{overview.permissions.sleep ? 'Wear your tracker to sleep, then sync in Google Health.' : 'Grant sleep access to see your nights here.'}</p>}
          <details><summary>Seven-day sleep trend</summary><Trend days={days} field="sleep_minutes" label="Sleep duration" format={duration} /><p className="health-muted">Main sleep by wake date. Stage availability depends on your device and processing.</p></details>
        </article>
        <article className="card health-recovery"><p className="overline">RECOVERY</p><h2>Listen to your baseline</h2>
          <div className="health-vitals"><div><span>Heart rate variability</span><strong>{count(latestHrv?.hrv)} <small>ms</small></strong><small>{latestHrv ? dateLabel(latestHrv.date) : 'No reading'}</small></div><div><span>Resting heart rate</span><strong>{count(latestHr?.resting_hr)} <small>bpm</small></strong><small>{latestHr ? dateLabel(latestHr.date) : 'No reading'}</small></div></div>
          <p className="health-muted">Your own trends matter. Wearable readings are estimates; how you feel matters too.</p>
          {!overview.permissions.recovery && <p className="health-muted">Grant health metrics access to see HRV and resting heart rate.</p>}
          <details><summary>Recovery trends</summary><p className="health-muted">Prior readings in this week (minimum three): HRV {count(average(hrvHistory, 'hrv'))} ms · resting heart rate {count(average(hrHistory, 'resting_hr'))} bpm. This is a short-term comparison, not a readiness score.</p><Trend days={days} field="hrv" label="Heart rate variability in milliseconds" /><Trend days={days} field="resting_hr" label="Resting heart rate in beats per minute" /></details>
          <button className="primary" disabled={busy || !hasRecovery} onClick={() => void run(() => askCoach(recoveryPrompt(overview)))}>Ask coach about recovery ↗</button>
          <small className="health-coach-note">Shares this seven-day summary with your AI coach. Training changes always require your action.</small>
        </article>
      </div>
      <details className="health-connection-details"><summary>Connection & permissions</summary><p className="health-muted">Activity {overview.permissions.activity ? '✓' : '—'} · Sleep {overview.permissions.sleep ? '✓' : '—'} · Recovery {overview.permissions.recovery ? '✓' : '—'}. Sync your wearable with Google Health first. Fetching here does not force your wearable to sync.</p>
        <div className="health-actions"><button className="secondary" disabled={busy} onClick={() => void connect()}>Update permissions</button><button className="secondary" disabled={busy} onClick={() => {
          if (window.confirm('Disconnect Google Health and remove imported health data from Jern? Health summaries already shared in coach conversations remain in those conversations.')) void run(async () => { await api('/health/google', { method: 'DELETE' }); setOverview(await api<HealthOverview>('/health/overview')); });
        }}>Disconnect & remove data</button></div>
      </details>
    </>}
  </section>;
}
