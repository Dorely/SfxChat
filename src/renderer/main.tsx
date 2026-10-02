import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { connectBrowserApi } from './browser-api'

if (!window.sfx) window.sfx = connectBrowserApi()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
