export type UserProfile = { email: string; name: string; firstName: string };

export function profileFromSession(session: { email?: string; name?: string; given_name?: string }): UserProfile {
  const email = session.email?.trim() ?? '';
  const name = session.name?.trim() ?? '';
  const emailName = email.split('@')[0]?.split(/[._-]+/)[0] ?? '';
  const fallback = emailName ? emailName.charAt(0).toLocaleUpperCase() + emailName.slice(1) : 'Athlete';
  const firstName = session.given_name?.trim() || name.split(/\s+/)[0] || fallback;
  return { email, name: name || firstName, firstName };
}
