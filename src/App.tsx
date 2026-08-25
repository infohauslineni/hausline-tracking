import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/auth/ProtectedRoute'
import { PrivateLayout } from './components/layout/PrivateLayout'
import { LoginPage } from './pages/public/LoginPage'

const ClientesPage = lazy(() => import('./pages/private/ClientesPage').then((module) => ({ default: module.ClientesPage })))
const ClienteDetailPage = lazy(() => import('./pages/private/ClienteDetailPage').then((module) => ({ default: module.ClienteDetailPage })))
const DashboardPage = lazy(() => import('./pages/private/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const NuevoPedidoPage = lazy(() => import('./pages/private/NuevoPedidoPage').then((module) => ({ default: module.NuevoPedidoPage })))
const PedidoDetailPage = lazy(() => import('./pages/private/PedidoDetailPage').then((module) => ({ default: module.PedidoDetailPage })))
const PedidosPage = lazy(() => import('./pages/private/PedidosPage').then((module) => ({ default: module.PedidosPage })))
const SolicitudesPage = lazy(() => import('./pages/private/SolicitudesPage').then((module) => ({ default: module.SolicitudesPage })))
const LogisticaPage = lazy(() => import('./pages/private/LogisticaPage').then((module) => ({ default: module.LogisticaPage })))
const ConfiguracionPage = lazy(() => import('./pages/private/ConfiguracionPage').then((module) => ({ default: module.ConfiguracionPage })))
const VentasPage = lazy(() => import('./pages/private/VentasPage').then((module) => ({ default: module.VentasPage })))
const ProductosPage = lazy(() => import('./pages/private/ProductosPage').then((module) => ({ default: module.ProductosPage })))
const PagosPage = lazy(() => import('./pages/private/PagosPage').then((module) => ({ default: module.PagosPage })))
const GastosPage = lazy(() => import('./pages/private/GastosPage').then((module) => ({ default: module.GastosPage })))
const CuentaPage = lazy(() => import('./pages/private/CuentaPage').then((module) => ({ default: module.CuentaPage })))
const ReportesPage = lazy(() => import('./pages/private/ReportesPage').then((module) => ({ default: module.ReportesPage })))
const InventarioPage = lazy(() => import('./pages/private/InventarioPage').then((module) => ({ default: module.InventarioPage })))
const MetasPage = lazy(() => import('./pages/private/MetasPage').then((module) => ({ default: module.MetasPage })))
const ContenidoPage = lazy(() => import('./pages/private/ContenidoPage').then((module) => ({ default: module.ContenidoPage })))
const TrackingPage = lazy(() => import('./pages/public/TrackingPage').then((module) => ({ default: module.TrackingPage })))

export function App() {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-app"><div className="loader" /></div>}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/tracking" element={<TrackingPage />} />
    <Route path="/tracking/:codigo" element={<TrackingPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<PrivateLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/solicitudes" element={<SolicitudesPage />} />
        <Route path="/pedidos/nuevo" element={<NuevoPedidoPage />} />
        <Route path="/pedidos/:id" element={<PedidoDetailPage />} />
        <Route path="/ventas" element={<VentasPage />} />
        <Route path="/productos" element={<ProductosPage />} />
        <Route path="/stock" element={<InventarioPage />} />
        <Route path="/inventario" element={<Navigate to="/stock" replace />} />
        <Route path="/inversiones" element={<Navigate to="/stock" replace />} />
        <Route path="/deudas" element={<Navigate to="/gastos" replace />} />
        <Route path="/metas" element={<MetasPage />} />
        <Route path="/contenido" element={<ContenidoPage />} />
        <Route path="/pagos" element={<PagosPage />} />
        <Route path="/gastos" element={<GastosPage />} />
        <Route path="/cuenta" element={<CuentaPage />} />
        <Route path="/reportes" element={<ReportesPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/clientes/:id" element={<ClienteDetailPage />} />
        <Route path="/logistica" element={<LogisticaPage />} />
        <Route path="/configuracion" element={<ConfiguracionPage />} />
      </Route>
    </Route>
    <Route path="/" element={<Navigate to="/tracking" replace />} />
    <Route path="*" element={<Navigate to="/tracking" replace />} />
  </Routes></Suspense>
}
