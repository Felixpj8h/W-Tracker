// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ProfileAvatar } from './ProfileAvatar';

afterEach(cleanup);

it('uses an initial when no Google picture is available', () => {
    render(<ProfileAvatar firstName="Felix"/>);
    expect(screen.getByLabelText("Felix's profile").textContent).toBe('F');
});

it('loads a new profile picture after an earlier picture fails', () => {
    const view = render(<ProfileAvatar firstName="Felix" picture="https://example.com/old.png"/>);
    fireEvent.error(view.container.querySelector('img')!);
    expect(screen.getByLabelText("Felix's profile").textContent).toBe('F');
    view.rerender(<ProfileAvatar firstName="Ada" picture="https://example.com/new.png"/>);
    expect(screen.getByLabelText("Ada's profile").querySelector('img')?.getAttribute('src')).toBe('https://example.com/new.png');
});
