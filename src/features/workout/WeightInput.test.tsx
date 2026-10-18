// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { WeightInput } from './WeightInput';

afterEach(cleanup);

it.each(['22.5', '22,5'])('allows typing %s through controlled state updates', async text => {
    const changed = vi.fn();
    function Harness() {
        const [weight, setWeight] = useState(0);
        return <WeightInput value={weight} label="Weight" onChange={value => { setWeight(value); changed(value); }}/>;
    }
    render(<Harness/>);
    const input = screen.getByRole('textbox', { name: 'Weight' }) as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(input, text.slice(0, -1));
    expect(input.value).toBe(text.slice(0, -1));
    await user.type(input, '5');
    expect(changed).toHaveBeenLastCalledWith(22.5);
    await user.tab();
    expect(input.value).toBe('22.5');
    await user.clear(input);
    expect(changed).toHaveBeenLastCalledWith(0);
});
