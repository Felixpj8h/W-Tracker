import { AuthGate } from '../features/auth/AuthGate';
import { WorkoutApp } from './WorkoutApp';
import './styles';

export default function App() {
    return <AuthGate>{user => <WorkoutApp user={user}/>}</AuthGate>;
}
