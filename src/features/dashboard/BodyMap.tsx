import { useState, useEffect, useId } from 'react';
import type { BodyMapMuscle } from './types';
import { api } from '../../shared/api/client';
import { demoApi } from '../demo/api';
import './body-map.css';

type BodyMapResult = { muscles: BodyMapMuscle[]; showing_last_seven_days?: boolean };

export function BodyMap({ readOnly = false, selectedWeek, throughToday = false }: { readOnly?: boolean; selectedWeek?: string; throughToday?: boolean }) {
    const [result, setResult] = useState<BodyMapResult | null>(null);
    const [unavailable, setUnavailable] = useState(false);
    const [retry, setRetry] = useState(0);
    const filterId = `heatmap-color-${useId().replace(/:/g, '')}`;

    useEffect(() => {
        const controller = new AbortController();
        const load = readOnly ? demoApi : api;
        setResult(null);
        setUnavailable(false);
        const query = selectedWeek ? `?selected_week=${selectedWeek}&through_today=${throughToday}` : '';
        void load<BodyMapResult>(`/dashboard/body-map${query}`, { signal: controller.signal })
            .then(data => {
                if (!controller.signal.aborted) { setResult(data); setUnavailable(false); }
            })
            .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
        return () => controller.abort();
    }, [readOnly, retry, selectedWeek, throughToday]);

    if (unavailable) return <div className="heatmap-status" role="status"><span>Could not load your muscle heatmap.</span><button type="button" onClick={() => { setUnavailable(false); setResult(null); setRetry(value => value + 1); }}>Retry heatmap</button></div>;
    if (result === null) return <div className="heatmap-status" role="status">Loading your muscle heatmap…</div>;
    const trained = result.muscles.filter(muscle => muscle.volume > 0);
    const emptyMessage = result.showing_last_seven_days ? 'No muscles trained in the last 7 days' : 'No muscles trained in the selected week';

    return <div className="muscle-heatmap">
        <svg className="heatmap-filters" aria-hidden="true" width="0" height="0">
            <defs><filter id={filterId} colorInterpolationFilters="sRGB">
                <feFlood style={{ floodColor: 'var(--heatmap-color, #315b40)' }} />
                <feComposite in2="SourceAlpha" operator="in" />
            </filter></defs>
        </svg>
        {result.showing_last_seven_days && <p className="heatmap-period">Last 7 days</p>}
        <div className="heatmap-bodies">
            {(['front', 'back'] as const).map(view => <figure key={view}>
                <div className="heatmap-figure" role="img" aria-label={`${view === 'front' ? 'Front' : 'Back'} muscle heatmap: ${trained.filter(muscle => muscle.is_front === (view === 'front')).map(muscle => `${muscle.name}, ${Math.round(muscle.volume).toLocaleString()} kg`).join('; ') || emptyMessage}`}>
                    <img className="heatmap-base" src={`/body-${view}.svg`} alt="" />
                    {trained.filter(muscle => muscle.is_front === (view === 'front')).map(muscle => <img
                        className="heatmap-layer" key={muscle.id} src={muscle.image_url} alt=""
                        style={{ filter: `url(#${filterId}) var(--heatmap-highlight-filter, brightness(1))`, opacity: .25 + Math.max(0, Math.min(1, muscle.intensity)) * .75 }}
                    />)}
                </div>
                <figcaption>{view === 'front' ? 'Front' : 'Back'}</figcaption>
            </figure>)}
        </div>
        <div className="heatmap-legend" aria-label="Training volume intensity, less to more"><span>Less</span><div>{[.15, .3, .5, .7, 1].map(opacity => <i key={opacity} style={{ opacity }} />)}</div><span>More</span></div>
    </div>;
}
