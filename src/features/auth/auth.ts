let googleIdToken = ''

export function setGoogleIdToken(token: string) {
  googleIdToken = token
}

export function authHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  if (googleIdToken) result.set('Authorization', `Bearer ${googleIdToken}`)
  return result
}

