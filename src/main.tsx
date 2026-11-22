import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './features/auth/auth.css'
import App from './app/App.tsx'
import { startViewportScale } from './shared/lib/viewportScale'
import { enableTouchPressStates, preventIosFocusZoom, startMobileViewport } from './shared/lib/mobileViewport'

import './features/dashboard/touch'

startViewportScale()
startMobileViewport()
preventIosFocusZoom()
enableTouchPressStates()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
