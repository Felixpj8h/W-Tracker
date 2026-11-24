import { useState, useEffect, useId } from 'react';
import { bodyMapKey, cachedBodyMap, loadBodyMap, type BodyMapResult } from './bodyMapData';
import './body-map.css';

/** Pass `onPeriodChange` to show the "Last 7 days" label elsewhere (the dashboard puts it in the card
 *  header) so the label does not take height from the body figures. */
export function BodyMap({ readOnly = false, selectedWeek, throughToday = false, onPeriodChange }: { readOnly?: boolean; selectedWeek?: string; throughToday?: boolean; onPeriodChange?: (showingLastSevenDays: boolean) => void }) {
    const key = bodyMapKey(readOnly, selectedWeek, throughToday);
    // The map on screen and the view it belongs to. While another week loads, the previous map stays
    // (dimmed) instead of collapsing to a loading message, so the card does not jump.
    const [shown, setShown] = useState<{ key: string; result: BodyMapResult } | null>(() => { const cached = cachedBodyMap(key); return cached ? { key, result: cached } : null; });
    const [unavailable, setUnavailable] = useState(false);
    const [retry, setRetry] = useState(0);
    const filterId = `heatmap-color-${useId().replace(/:/g, '')}`;

    useEffect(() => {
        let active = true;
        const cached = cachedBodyMap(key);
        if (cached) setShown({ key, result: cached });
        setUnavailable(false);
        loadBodyMap(readOnly, selectedWeek, throughToday, { force: retry > 0 })
            .then(data => { if (active) setShown({ key, result: data }); })
            .catch(() => { if (active && !cached) setUnavailable(true); });
        return () => { active = false; };
    }, [key, readOnly, retry, selectedWeek, throughToday]);

    const result = shown?.result ?? null;
    const updating = shown !== null && shown.key !== key;

    useEffect(() => { onPeriodChange?.(Boolean(result?.showing_last_seven_days)); }, [onPeriodChange, result]);

    if (unavailable) return <div className="heatmap-status" role="status"><span>Could not load your muscle heatmap.</span><button type="button" onClick={() => { setUnavailable(false); setShown(null); setRetry(value => value + 1); }}>Retry heatmap</button></div>;
    if (result === null) return <div className="heatmap-status" role="status">Loading your muscle heatmap…</div>;
    const trained = result.muscles.filter(muscle => muscle.volume > 0);
    const emptyMessage = result.showing_last_seven_days ? 'No muscles trained in the last 7 days' : 'No muscles trained in the selected week';

    return <div className={`muscle-heatmap ${updating ? 'is-updating' : ''}`} aria-busy={updating}>
        <svg className="heatmap-filters" aria-hidden="true" width="0" height="0">
            <defs><filter id={filterId} colorInterpolationFilters="sRGB">
                <feFlood style={{ floodColor: 'var(--heatmap-color, #315b40)' }} />
                <feComposite in2="SourceAlpha" operator="in" />
            </filter></defs>
        </svg>
        {result.showing_last_seven_days && !onPeriodChange && <p className="heatmap-period">Last 7 days</p>}
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
