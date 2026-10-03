import { useState, useEffect } from 'react';
import type { BodyMapMuscle } from './types';
import { api } from '../../shared/api/client';

const WGER_BODY_BASE = {
    front: '/body-front.svg',
    back: '/body-back.svg'
};

export function BodyMap() {
    const [muscles, setMuscles] = useState<BodyMapMuscle[] | null>(null);
    const [mapUnavailable, setMapUnavailable] = useState(false);
    const [view, setView] = useState<'front' | 'back'>('front');
    const [testMode, setTestMode] = useState(false);
    const [testing, setTesting] = useState(false);
    const loadMap = async () => {
        try {
            const result = await api<{ muscles: BodyMapMuscle[]; test_mode: boolean }>('/dashboard/body-map');
            setMuscles(result.muscles); setTestMode(result.test_mode); setMapUnavailable(false);
        } catch { setMapUnavailable(true); setMuscles([]); }
    };
    useEffect(() => { void loadMap(); }, []);
    const toggleTestMode = async () => {
        setTesting(true);
        try { await api('/dashboard/body-map/test-data', { method: testMode ? 'DELETE' : 'POST' }); await loadMap(); }
        finally { setTesting(false); }
    };
    const trainedMuscles = [...(muscles ?? [])].filter(muscle => muscle.volume > 0).sort((a, b) => b.volume - a.volume);
    const strongest = trainedMuscles.slice(0, 3);
    const visibleMuscles = (muscles ?? []).filter(muscle => muscle.is_front === (view === 'front'));
    return <div className="body-map"><div className="body-map-copy"><span>THIS WEEK</span><b>Muscles trained</b><small>{mapUnavailable ? 'Restart the API to load your muscle overlays.' : muscles === null ? 'Loading your training map…' : trainedMuscles.length ? `${trainedMuscles.length} muscle region${trainedMuscles.length === 1 ? '' : 's'} hit` : 'Complete a workout to light up your map.'}</small><div className="body-map-view-toggle"><button className={view === 'front' ? 'active' : ''} onClick={() => setView('front')}>Front</button><button className={view === 'back' ? 'active' : ''} onClick={() => setView('back')}>Back</button></div><button className={`body-map-test ${testMode ? 'active' : ''}`} onClick={() => void toggleTestMode()} disabled={testing}>{testing ? 'Updating test…' : testMode ? 'Clear map test' : 'Test full map'}</button></div><div className="body-map-figure" aria-label={`${view} muscles trained this week`}><img className="wger-body-base" src={WGER_BODY_BASE[view]} alt=""/>{visibleMuscles.map(muscle => <img className="wger-muscle-layer" key={muscle.id} src={muscle.image_url} alt="" style={{ opacity: .24 + muscle.intensity * .76 }} />)}</div>{strongest.length > 0 && <div className="body-map-list">{strongest.map(muscle => <span key={muscle.id}>{muscle.name}<b>{Math.round(muscle.volume).toLocaleString()} kg</b></span>)}</div>}</div>;
}
