import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { normalizeDisplayedDigits } from './lib/digits'
import App from './App.tsx'

Object.assign(window, { EXCALIDRAW_ASSET_PATH: '/board-assets/' })

document.documentElement.dir = 'ltr'
document.documentElement.lang = 'en'

normalizeDisplayedDigits(document.body)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
