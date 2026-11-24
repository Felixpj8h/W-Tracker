import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import './sets-radar.css';

export type RadarRow = { name: string; current: number; previous: number | null };

/** Fixed anatomical order, so a muscle keeps its spoke and the shape stays comparable week to week:
 *  push muscles first, then pull, legs and core. */
const AXIS_ORDER = ['Chest', 'Front delts', 'Side delts', 'Triceps', 'Rear delts', 'Lats', 'Rhomboids', 'Traps', 'Biceps', 'Forearms',
    'Spinal erectors', 'Glutes', 'Hamstrings', 'Quads', 'Adductors', 'Calves', 'Abs', 'Obliques'];
const FALLBACK_SIZE = { width: 440, height: 260 };
const LINE_HEIGHT = 12;
const CHAR_WIDTH = 6.1;
const LABEL_GAP = 7;
const LEGEND_ROW = 26;


const orderIndex = (name: string) => { const index = AXIS_ORDER.indexOf(name); return index === -1 ? AXIS_ORDER.length : index; };
const formatSets = (value: number) => `${Number(value.toFixed(2))} ${value === 1 ? 'set' : 'sets'}`;
const changeLabel = (current: number, previous: number | null) => {
    if (!previous) return null;
    const change = Math.round((current - previous) / previous * 100);
    return `${change >= 0 ? '+' : ''}${change}%`;
};

/** Ring step: 1, 2, 2.5 or 5 times a power of ten, so at most four rings cover the largest value. */
function ringScale(max: number) {
    if (max <= 4) { const rings = Math.max(2, Math.ceil(max)); return { step: 1, rings }; }
    const raw = max / 4, power = 10 ** Math.floor(Math.log10(raw)), n = raw / power;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * power;
    return { step, rings: Math.ceil(max / step) };
}

function useSize() {
    const ref = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState(FALLBACK_SIZE);
    useEffect(() => {
        const element = ref.current;
        if (!element || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) setSize(previous => previous.width === Math.round(width) && previous.height === Math.round(height) ? previous : { width: Math.round(width), height: Math.round(height) });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, size] as const;
}

export function SetsRadar({ rows, currentLabel, comparisonLabel }: { rows: RadarRow[]; currentLabel: string; comparisonLabel: string | null }) {
    const [boxRef, { width, height }] = useSize();
    const [active, setActive] = useState<number | null>(null);
    const axes = [...rows].sort((a, b) => orderIndex(a.name) - orderIndex(b.name) || a.name.localeCompare(b.name));
    const hasComparison = comparisonLabel !== null && axes.some(axis => axis.previous !== null);
    const count = axes.length;
    const max = Math.max(...axes.flatMap(axis => [axis.current, axis.previous ?? 0]));
    const { step, rings } = ringScale(max);
    const scaleMax = step * rings;

    const angle = (index: number) => -Math.PI / 2 + index * 2 * Math.PI / count;
    // Size the chart from each label's real position: a label beside a diagonal spoke needs far less
    // room than one level with the centre, so only the labels that actually reach an edge limit the radius.
    const extent = (lines: string[], index: number) => {
        const cos = Math.abs(Math.cos(angle(index))), sin = Math.abs(Math.sin(angle(index)));
        const labelWidth = Math.max(...lines.map(line => line.length)) * CHAR_WIDTH, labelHeight = lines.length * LINE_HEIGHT;
        return { cos, sin, x: cos > 0.25 ? labelWidth : labelWidth / 2, y: sin > 0.5 ? labelHeight : labelHeight / 2 };
    };
    const radiusFor = (labelSet: string[][], plotHeight: number) => labelSet.reduce((r, lines, index) => {
        const { cos, sin, x, y } = extent(lines, index);
        const byWidth = cos > 0.01 ? (width / 2 - 4 - x) / cos - LABEL_GAP : Infinity;
        const byHeight = sin > 0.01 ? (plotHeight / 2 - 4 - y) / sin - LABEL_GAP : Infinity;
        return Math.min(r, byWidth, byHeight);
    }, Math.min(width, plotHeight) / 2);
    const single = axes.map(axis => [axis.name]);
    const wrapped = axes.map(axis => axis.name.split(' ').length === 2 ? axis.name.split(' ') : [axis.name]);
    const fit = (plotHeight: number) => {
        const labels = radiusFor(wrapped, plotHeight) > radiusFor(single, plotHeight) + 4 ? wrapped : single;
        const radius = Math.max(30, radiusFor(labels, plotHeight));
        return { labels, radius };
    };
    // On a wide card the chart is limited by height, which leaves room beside it: put the legend there
    // and give the chart the full height. Otherwise the legend takes a row above the chart.
    const labelBox = (lines: string[], index: number, r: number, centerX: number, centerY: number) => {
        const cos = Math.cos(angle(index)), sin = Math.sin(angle(index));
        const x = centerX + (r + LABEL_GAP) * cos, y = centerY + (r + LABEL_GAP) * sin;
        const labelWidth = Math.max(...lines.map(line => line.length)) * CHAR_WIDTH, labelHeight = lines.length * LINE_HEIGHT;
        const left = cos > 0.25 ? x : cos < -0.25 ? x - labelWidth : x - labelWidth / 2;
        const middle = y + (sin < -0.5 ? -labelHeight / 2 : sin > 0.5 ? labelHeight / 2 : 0);
        return { left, right: left + labelWidth, top: middle - labelHeight / 2, bottom: middle + labelHeight / 2 };
    };
    // The legend (and the hover readout that replaces it) stacks in the top-left corner when that corner is
    // clear of the chart and its labels; the chart then gets the full height.
    const legendWidth = (hasComparison ? Math.max(currentLabel.length, (comparisonLabel ?? '').length) + 9 : 16) * CHAR_WIDTH + 26;
    const legendHeight = hasComparison ? 4 * 18 : 2 * 18;
    const fullHeight = fit(height);
    const sideLegend = (() => {
        const centerX = width / 2, centerY = height / 2, r = fullHeight.radius;
        const nearestX = Math.min(Math.max(centerX, 0), legendWidth), nearestY = Math.min(Math.max(centerY, 0), legendHeight);
        if (Math.hypot(centerX - nearestX, centerY - nearestY) < r + 6) return false;
        return fullHeight.labels.every((lines, index) => { const box = labelBox(lines, index, r, centerX, centerY); return box.left > legendWidth + 6 || box.top > legendHeight + 4; });
    })();
    const top = sideLegend ? 0 : LEGEND_ROW;
    const { labels, radius } = sideLegend ? fullHeight : fit(height - top);
    const cx = width / 2, cy = top + (height - top) / 2;

    const point = (index: number, r: number) => [cx + r * Math.cos(angle(index)), cy + r * Math.sin(angle(index))] as const;
    const valuePoint = (index: number, value: number) => point(index, value / scaleMax * radius);
    const polygon = (points: readonly (readonly [number, number])[]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const ring = (r: number) => polygon(axes.map((_, index) => point(index, r)));
    const currentPoints = axes.map((axis, index) => valuePoint(index, axis.current));
    const previousPoints = axes.map((axis, index) => valuePoint(index, axis.previous ?? 0));
    const wedge = (index: number) => {
        const half = Math.PI / count, outer = radius + 34;
        const at = (a: number) => `${(cx + outer * Math.cos(a)).toFixed(1)},${(cy + outer * Math.sin(a)).toFixed(1)}`;
        return `${cx},${cy} ${at(angle(index) - half)} ${at(angle(index))} ${at(angle(index) + half)}`;
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (next) { event.preventDefault(); setActive(current => current === null ? 0 : (current + next + count) % count); }
        else if (event.key === 'Escape') setActive(null);
        else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
        else if (event.key === 'End') { event.preventDefault(); setActive(count - 1); }
    };

    const activeAxis = active === null ? null : axes[active];
    const activeChange = activeAxis ? changeLabel(activeAxis.current, activeAxis.previous) : null;
    const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
    const currentTotal = total(axes.map(axis => axis.current));
    const previousTotal = total(axes.map(axis => axis.previous ?? 0));

    // One row above the plot: the legend with period totals, or the hovered muscle's numbers.
    // Keeping the readout out of the plot means it never covers a spoke label, even on a phone.
    return <div className="sets-radar" ref={boxRef}>
        <div className={`sets-radar-legend ${sideLegend ? 'side' : ''}`} aria-hidden="true">
            {activeAxis ? <>
                <b>{activeAxis.name}</b>
                <span><i className="current"/>{formatSets(activeAxis.current)}</span>
                {hasComparison && <span><i className="previous"/>{formatSets(activeAxis.previous ?? 0)}</span>}
                {hasComparison && activeChange && <em className={activeChange.startsWith('-') ? 'negative' : ''}>{activeChange}</em>}
            </> : <>
                {hasComparison ? <>
                    <span><i className="current"/>{currentLabel}<small>{formatSets(currentTotal)}</small></span>
                    <span><i className="previous"/>{comparisonLabel}<small>{formatSets(previousTotal)}</small></span>
                </> : <span><i className="current"/><small>{formatSets(currentTotal)} total</small></span>}
            </>}
        </div>
        <div
            className="sets-radar-plot"
            tabIndex={0}
            role="group"
            aria-label="Sets by muscle radar chart. Use the arrow keys to read each muscle."
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
        >
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" onPointerLeave={event => { if (event.pointerType === 'mouse') setActive(null); }}>
                <g className="sets-radar-grid">
                    {Array.from({ length: rings }, (_, ringIndex) => {
                        const r = (ringIndex + 1) / rings * radius;
                        return <polygon key={ringIndex} points={ring(r)} className={ringIndex === rings - 1 ? 'outer' : ''}/>;
                    })}
                    {axes.map((axis, index) => { const [x, y] = point(index, radius); return <line key={axis.name} x1={cx} y1={cy} x2={x} y2={y} className={index === active ? 'active' : ''}/>; })}
                </g>
                <g className="sets-radar-series" style={{ transformOrigin: `${cx}px ${cy}px` }}>
                    {hasComparison && <>
                        <polygon className="previous-area" points={polygon(previousPoints)}/>
                        {previousPoints.map(([x, y], index) => <circle key={axes[index].name} className="previous-dot" cx={x} cy={y} r={index === active ? 4.5 : 3}/>)}
                    </>}
                    <polygon className="current-area" points={polygon(currentPoints)}/>
                    {currentPoints.map(([x, y], index) => <circle key={axes[index].name} className="current-dot" cx={x} cy={y} r={index === active ? 6 : 4.5}/>)}
                </g>
                <g className="sets-radar-labels">
                    {axes.map((axis, index) => {
                        const a = angle(index), cos = Math.cos(a), sin = Math.sin(a);
                        const [x, y] = point(index, radius + LABEL_GAP);
                        const lines = labels[index];
                        const blockHeight = lines.length * LINE_HEIGHT;
                        const centerY = y + (sin < -0.5 ? -blockHeight / 2 : sin > 0.5 ? blockHeight / 2 : 0);
                        const anchor = cos > 0.25 ? 'start' : cos < -0.25 ? 'end' : 'middle';
                        return <text key={axis.name} x={x} textAnchor={anchor} className={index === active ? 'active' : ''}>
                            {lines.map((line, lineIndex) => <tspan key={line} x={x} y={centerY - (lines.length - 1) * LINE_HEIGHT / 2 + lineIndex * LINE_HEIGHT} dominantBaseline="middle">{line}</tspan>)}
                        </text>;
                    })}
                </g>
                <g className="sets-radar-hits">
                    {axes.map((axis, index) => <polygon key={axis.name} points={wedge(index)} onPointerEnter={() => setActive(index)} onPointerDown={() => setActive(index)}/>)}
                </g>
            </svg>
        </div>
        <p className="sets-radar-sr" aria-live="polite">{activeAxis ? `${activeAxis.name}: ${formatSets(activeAxis.current)}${hasComparison ? `, ${comparisonLabel} ${formatSets(activeAxis.previous ?? 0)}${activeChange ? `, ${activeChange}` : ''}` : ''}` : ''}</p>
        <table className="sets-radar-sr">
            <caption>Sets by muscle</caption>
            <thead><tr><th scope="col">Muscle</th><th scope="col">{currentLabel}</th>{hasComparison && <><th scope="col">{comparisonLabel}</th><th scope="col">Change</th></>}</tr></thead>
            <tbody>
                {axes.map(axis => <tr key={axis.name}>
                    <th scope="row">{axis.name}</th>
                    <td>{formatSets(axis.current)}</td>
                    {hasComparison && <><td>{formatSets(axis.previous ?? 0)}</td><td>{changeLabel(axis.current, axis.previous) ?? '—'}</td></>}
                </tr>)}
            </tbody>
        </table>
    </div>;
}
