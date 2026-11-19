import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import './features/auth/auth.css'
import App from './app/App.tsx'
import { startViewportScale } from './shared/lib/viewportScale'

import './features/dashboard/touch'

startViewportScale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
