import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './services/firebase/config.js'
import './styles/global.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((cause) => {
      console.warn('Não foi possível registrar o modo instalável do Print Caju.', cause)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter><App /></BrowserRouter>
  </StrictMode>,
)
