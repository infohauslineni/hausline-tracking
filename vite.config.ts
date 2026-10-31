import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Solo en `npm run dev`: sirve /api/catalogo con la misma lógica de la función de Vercel, para
// probar la pantalla Productos en la vista previa local. No afecta al build de producción.
function catalogoLocal(): Plugin {
  return {
    name: 'catalogo-local',
    configureServer(server) {
      server.middlewares.use('/api/catalogo', async (req: { url?: string }, res) => {
        try {
          const ruta = 'file:///' + (globalThis as unknown as { process: { cwd: () => string } }).process.cwd().split('\\').join('/') + '/api/_catalogo.js'
          const mod = (await import(/* @vite-ignore */ ruta)) as { leerBaseCruda: () => Promise<unknown>; obtenerCatalogoMergeado: () => Promise<unknown> }
          const base = /[?&]base=1/.test(req.url ?? '')
          const datos = base ? await mod.leerBaseCruda() : await mod.obtenerCatalogoMergeado()
          res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(datos))
        } catch (e) { res.statusCode = 502; res.end(JSON.stringify({ error: String(e) })) }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), catalogoLocal()],
})
