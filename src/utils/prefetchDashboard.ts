const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('../pages/private/DashboardPage'),
  '/ventas': () => import('../pages/private/VentasPage'),
  '/pedidos': () => import('../pages/private/PedidosPage'),
  '/clientes': () => import('../pages/private/ClientesPage'),
  '/productos': () => import('../pages/private/ProductosPage'),
  '/stock': () => import('../pages/private/StockPage'),
  '/inversiones': () => import('../pages/private/InversionesPage'),
  '/pagos': () => import('../pages/private/PagosPage'),
  '/gastos': () => import('../pages/private/GastosPage'),
  '/cuenta': () => import('../pages/private/CuentaPage'),
  '/deudas': () => import('../pages/private/DeudasPage'),
  '/metas': () => import('../pages/private/MetasPage'),
  '/contenido': () => import('../pages/private/ContenidoPage'),
  '/reportes': () => import('../pages/private/ReportesPage'),
  '/logistica': () => import('../pages/private/LogisticaPage'),
  '/configuracion': () => import('../pages/private/ConfiguracionPage'),
}

export function prefetchRoute(path: string) {
  void routeLoaders[path]?.()
}

export function warmDashboard() {
  const run = async () => {
    Object.values(routeLoaders).forEach((loader) => void loader())
    const [{ listarProductos, listarInversiones }, { listarPedidos }, { listarClientes }, { listarIdeasContenido }] = await Promise.all([
      import('../services/comercial.service'),
      import('../services/pedidos.service'),
      import('../services/clientes.service'),
      import('../services/contenido.service'),
    ])
    await Promise.allSettled([listarProductos(), listarInversiones(), listarPedidos(), listarClientes(), listarIdeasContenido()])
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => void run(), { timeout: 2500 })
  } else {
    globalThis.setTimeout(() => void run(), 700)
  }
}
