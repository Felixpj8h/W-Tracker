import './jern-logo.css';

export function JernLogo({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' | 'auth' }) {
    return <span className={`jern-logo jern-logo--${variant}`}>
        <span className="jern-logo__mark" aria-hidden="true" />
        <span className="jern-logo__wordmark">Jern</span>
    </span>;
}
