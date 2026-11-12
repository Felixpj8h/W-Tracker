import { useState } from 'react';
import './profile-avatar.css';

export function ProfileAvatar({ firstName, picture }: { firstName: string; picture?: string }) {
    const [failedPicture, setFailedPicture] = useState<string>();
    return <i className="profile-avatar" aria-label={`${firstName}'s profile`}>
        {picture && failedPicture !== picture
            ? <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailedPicture(picture)}/>
            : (firstName || 'A').charAt(0).toLocaleUpperCase()}
    </i>;
}
