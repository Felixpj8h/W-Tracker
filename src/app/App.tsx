import { AuthGate } from '../features/auth/AuthGate';
import { WorkoutApp } from './WorkoutApp';
import { useEffect, useState } from 'react';
import { DemoApp } from '../features/demo/DemoApp';
import './styles';

export default function App() {
    const [mode, setMode] = useState<'authenticated' | 'demo'>(() => window.location.pathname.replace(/\/$/, '') === '/demo' ? 'demo' : 'authenticated');
    const [skipRestore, setSkipRestore] = useState(false);
    useEffect(() => {
        const navigate = () => setMode(window.location.pathname.replace(/\/$/, '') === '/demo' ? 'demo' : 'authenticated');
        window.addEventListener('popstate', navigate);
        return () => window.removeEventListener('popstate', navigate);
    }, []);
    const enterDemo = () => { window.history.pushState(null, '', '/demo'); setMode('demo'); };
    const exitDemo = () => { window.history.pushState(null, '', '/'); setSkipRestore(true); setMode('authenticated'); };
    return mode === 'demo' ? <DemoApp key="demo" exit={exitDemo}/> : <AuthGate key="authenticated" onExploreDemo={enterDemo} skipRestore={skipRestore}>{user => <WorkoutApp user={user}/>}</AuthGate>;
}
