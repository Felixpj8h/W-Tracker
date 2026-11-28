// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { BodyweightCard } from './BodyweightCard';
import type { Dash } from '../types';

afterEach(cleanup);

it('starts the 1M line at the left edge when older weigh-ins exist', () => {
    const weights = [{ recorded_on: '2026-10-01', weight: 82 }, { recorded_on: '2026-11-10', weight: 80 }, { recorded_on: '2026-11-28', weight: 79 }];
    const { container } = render(<BodyweightCard dash={{ latest_weight: weights[2], weight_series: weights } as Dash} saveWeight={async () => undefined}/>);
    fireEvent.click(screen.getByText('1M'));
    expect(container.querySelector('.weight-curve')!.getAttribute('d')).toMatch(/^M 2,/);
    // Only weigh-ins inside the range are interactive points.
    expect(container.querySelectorAll('.weight-point-circle')).toHaveLength(2);
});
