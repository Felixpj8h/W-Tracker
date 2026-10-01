import { describe, expect, it } from 'vitest';
import { profileFromSession } from './profile';

describe('profileFromSession', () => {
  it('uses the verified Google given name and full name', () => {
    expect(profileFromSession({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      given_name: 'Ada',
    })).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace', firstName: 'Ada' });
  });

  it('falls back to the full name and then the email prefix', () => {
    expect(profileFromSession({ email: 'grace@example.com', name: 'Grace Hopper' }).firstName).toBe('Grace');
    expect(profileFromSession({ email: 'linus.torvalds@example.com' }).firstName).toBe('Linus');
  });
});
