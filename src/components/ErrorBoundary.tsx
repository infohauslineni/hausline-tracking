import { Component, type ReactNode } from 'react'
import { recargarUnaVez } from '../lib/reloadOnce'

// Detecta un fallo al cargar un "chunk" (import dinámico). Pasa sobre todo DESPUÉS de un
// deploy: la página abierta pide un archivo con el hash viejo que ya no existe (404) y la
// pantalla se queda en negro. La cura estándar es recargar una vez para tomar la versión nueva.
function esErrorDeChunk(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /ChunkLoadError|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)
}

type State = { error: Error | null }

// Envuelve la app: si algo revienta al renderizar, en vez de dejar la pantalla negra muestra
// un aviso con botón "Recargar". Si fue un chunk viejo tras deploy, recarga solo una vez.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    if (esErrorDeChunk(error)) recargarUnaVez()
  }

  render() {
    if (!this.state.error) return this.props.children
    // Un chunk viejo ya disparó la recarga; mientras tanto mostramos el spinner.
    if (esErrorDeChunk(this.state.error)) return <div className="grid min-h-screen place-items-center bg-app"><div className="loader" /></div>
    return <div className="grid min-h-screen place-items-center bg-app p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-semibold">Algo salió mal</h1>
        <p className="mt-2 text-sm text-muted">La app tuvo un problema al cargar. Recargá para volver a intentarlo; tus datos están a salvo.</p>
        <button className="primary-button mt-6 w-full justify-center" onClick={() => window.location.reload()}>Recargar</button>
      </div>
    </div>
  }
}
