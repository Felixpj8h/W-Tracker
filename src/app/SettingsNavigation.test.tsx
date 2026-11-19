// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';
import { MobileNavigation } from './MobileNavigation';

afterEach(cleanup);

it('opens Settings from the signed-in sidebar and mobile More menu instead of a theme switch', () => {
    const setPage = vi.fn();
    const { container } = render(<><Sidebar page="dashboard" setPage={setPage} dark setDark={vi.fn()}/><MobileNavigation page="dashboard" setPage={setPage} dashboardPage={0} setDashboardPage={vi.fn()} dark setDark={vi.fn()} logWorkout={vi.fn()}/></>);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;
    expect(within(sidebar).queryByLabelText('Dark mode')).toBeNull();
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Settings' }));
    expect(setPage).toHaveBeenLastCalledWith('settings');
    setPage.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'More pages' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).getByRole('button', { name: '♡ Health' })).toBeTruthy();
    expect(within(sheet).queryByLabelText('Dark mode')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '⚙ Settings' }));
    expect(setPage).toHaveBeenLastCalledWith('settings');
});

it('keeps the read-only demo appearance switch and no Settings entry', () => {
    const setDark = vi.fn();
    const { container } = render(<><Sidebar readOnly page="dashboard" setPage={vi.fn()} dark setDark={setDark}/><MobileNavigation readOnly page="dashboard" setPage={vi.fn()} dashboardPage={0} setDashboardPage={vi.fn()} dark setDark={setDark} logWorkout={vi.fn()}/></>);
    const sidebar = container.querySelector('.sidebar') as HTMLElement;
    expect(within(sidebar).queryByRole('button', { name: 'Settings' })).toBeNull();
    fireEvent.click(within(sidebar).getByLabelText('Dark mode'));
    expect(setDark).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'More pages' }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(within(sheet).getByLabelText('Dark mode')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: '⚙ Settings' })).toBeNull();
});
