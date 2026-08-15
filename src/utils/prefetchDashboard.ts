const routeLoaders: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('../pages/private/DashboardPage'),
  '/ventas': () => import('../pages/private/VentasPage'),
  '/pedidos': () => import('../pages/private/PedidosPage'),
  '/clientes': () => import('../pages/private/ClientesPage'),
  '/productos': () => import('../pages/private/ProductosPage'),
  '/stock': () => import('../pages/private/InventarioPage'),
  '/pagos': () => import('../pages/private/PagosPage'),
  '/gastos': () => import('../pages/private/GastosPage'),
  '/cuenta': () => import('../pages/private/CuentaPage'),
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
    const [comercial, { listarPedidos }, { listarClientes }, { listarIdeasContenido }, { periodoDeMes }] = await Promise.all([
      import('../services/comercial.service'),
      import('../services/pedidos.service'),
      import('../services/clientes.service'),
      import('../services/contenido.service'),
      import('./periodo'),
    ])
    const { listarProductos, listarInversiones, listarPagos, listarGastos, listarMovimientos, obtenerResumenComercial, obtenerCajaMes } = comercial
    const periodo = periodoDeMes()
    // Calienta también los datos de dinero (Mi cuenta / Resumen) para que entren al instante.
    await Promise.allSettled([
      listarProductos(), listarInversiones(), listarPedidos(), listarClientes(), listarIdeasContenido(),
      listarPagos(), listarGastos(), listarMovimientos(),
      obtenerResumenComercial(periodo.desde, periodo.hasta), obtenerCajaMes(periodo.periodo),
    ])
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => void run(), { timeout: 2500 })
  } else {
    globalThis.setTimeout(() => void run(), 700)
  }
}
