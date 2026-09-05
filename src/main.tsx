import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import { recargarUnaVez } from './lib/reloadOnce'
import './styles.css'

// Tras un deploy, una pestaña abierta puede pedir un chunk con el hash viejo (ya no existe).
// Vite emite este evento cuando falla la precarga de un módulo: recargamos (como máximo una
// vez cada 15 s) para tomar la versión nueva, en vez de dejar la pantalla en negro.
window.addEventListener('vite:preloadError', () => { recargarUnaVez() })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <App />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
)
