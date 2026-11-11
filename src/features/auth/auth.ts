let googleIdToken = ''

export function setGoogleIdToken(token: string) {
  googleIdToken = token
}

export function authHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers)
  if (googleIdToken) result.set('Authorization', `Bearer ${googleIdToken}`)
  return result
}


let account = ''
let generation = 0
let authenticated = true
let requests = new AbortController()
export const sessionGeneration = () => generation
export const sessionIsCurrent = (value: number) => authenticated && value === generation
export const sessionSignal = () => requests.signal
export const accountKey = (key: string) => account ? key + ':' + encodeURIComponent(account) : key
export function activateAccount(email: string) {
  const next = email.trim().toLowerCase()
  if (next === account && authenticated) return
  requests.abort()
  requests = new AbortController()
  generation += 1
  account = next
  authenticated = true
}
export function broadcastAccountChange() {
  try { localStorage.setItem('workout-account-event', crypto.randomUUID()) }
  catch { /* Session validation still protects requests when storage is unavailable. */ }
}

export function invalidateAccount() {
  authenticated = false
  generation += 1
  requests.abort()
  requests = new AbortController()
  googleIdToken = ''
  try {
    for (const key of Object.keys(localStorage)) {
      const workoutCache = key.startsWith('workout-active-session') || key.startsWith('workout-position:')
      const currentAccount = account && key.endsWith(':' + encodeURIComponent(account))
      const legacy = key === 'workout-active-session' || (key.startsWith('workout-position:') && !key.includes('%40'))
      if (workoutCache && (currentAccount || legacy)) localStorage.removeItem(key)
    }
  } catch { /* Requests remain invalidated even when browser storage is unavailable. */ }
}
