import { DEMO_PEDIDOS } from '../data/demo'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { etapaBase } from '../constants/orders'
import type { EstadoPedido } from '../types/domain'

// Panel del CLIENTE ("Mi cuenta"): cuenta, direcciones, lista de deseos y pedidos.
// Todo pasa por RLS (cada cliente solo ve lo suyo) y RPCs de la migración
// 202609230001_cuentas_cliente.sql. Sin Supabase (preview local) funciona con datos demo
// guardados en este navegador, para poder revisar el diseño completo.

export type CuentaCliente = { user_id: string; nombre: string; telefono: string | null; correo: string; avatar_path: string | null; idioma: 'es' | 'en'; moneda: 'USD' | 'NIO' }
export type TipoDireccion = 'residencial' | 'trabajo' | 'otro'
export type Direccion = {
  id: string; nombre: string; direccion: string; referencia: string | null; ciudad: string; departamento: string | null
  pais: string; codigo_postal: string | null; tipo: TipoDireccion; lat: number | null; lng: number | null
  predeterminada: boolean; costo_delivery: number | null; created_at?: string
}
export type DireccionInput = Omit<Direccion, 'id' | 'costo_delivery' | 'created_at'>
export type Tarifa = { zona: string; costo: number; moneda: string }
export type Favorito = { codigo: string; nombre: string; marca: string | null; precio: number | null; imagen: string | null; created_at: string }
export type PedidoCuenta = {
  codigo: string; estado_codigo: EstadoPedido; fecha_pedido: string; fecha_estimada: string | null
  total: number | null; saldo: number | null; moneda: string | null; entrega_solicitada_at: string | null
  items: number; producto: string | null; marca: string | null; talla: string | null; color: string | null; imagen: string | null
}
export type DireccionSnapshot = Pick<Direccion, 'nombre' | 'direccion' | 'referencia' | 'ciudad' | 'departamento' | 'pais' | 'codigo_postal' | 'lat' | 'lng'> & { id?: string }
export type EntregaPedido = { solicitada_at: string | null; direccion: DireccionSnapshot | null; costo: number | null }

export const TIENDA_URL = (import.meta.env.VITE_CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')
export const esDemo = !isSupabaseConfigured || !supabase

function db() {
  if (!supabase) throw new Error('Supabase no está configurado.')
  return supabase
}

/* ------------------------------- Autenticación ------------------------------- */
const origen = () => import.meta.env.VITE_PUBLIC_APP_URL ?? window.location.origin

export async function registrarCliente(input: { nombre: string; correo: string; telefono: string; password: string }) {
  const { data, error } = await db().auth.signUp({
    email: input.correo.trim().toLowerCase(),
    password: input.password,
    // tipo=cliente → el trigger crea la cuenta de cliente y NUNCA un perfil del panel.
    options: { data: { tipo: 'cliente', nombre: input.nombre.trim(), telefono: input.telefono.trim() }, emailRedirectTo: `${origen()}/cuenta` },
  })
  if (error) throw error
  return { requiereConfirmacion: !data.session }
}

export async function ingresarCliente(correo: string, password: string) {
  const { error } = await db().auth.signInWithPassword({ email: correo.trim().toLowerCase(), password })
  if (error) throw error
}

export async function recuperarClave(correo: string) {
  const { error } = await db().auth.resetPasswordForEmail(correo.trim().toLowerCase(), { redirectTo: `${origen()}/cuenta/ingresar?recuperar=1` })
  if (error) throw error
}

export async function cambiarClave(password: string) {
  const { error } = await db().auth.updateUser({ password })
  if (error) throw error
}

export async function cambiarCorreo(correo: string) {
  // Supabase manda un enlace de confirmación al correo nuevo; el cambio se aplica al abrirlo.
  const { error } = await db().auth.updateUser({ email: correo.trim().toLowerCase() }, { emailRedirectTo: `${origen()}/cuenta/datos` })
  if (error) throw error
}

export async function salirCliente() {
  if (esDemo) return
  await db().auth.signOut()
}

/* ---------------------------------- Demo local --------------------------------- */
const DEMO_KEY = 'hausline.cuenta.demo'
type DemoState = { cuenta: CuentaCliente; direcciones: Direccion[]; favoritos: Favorito[]; entregas: Record<string, EntregaPedido> }
function demoInicial(): DemoState {
  const ahora = new Date().toISOString()
  return {
    cuenta: { user_id: 'demo', nombre: 'Cliente', telefono: '+505 8888 8888', correo: 'cliente@email.com', avatar_path: null, idioma: 'es', moneda: 'USD' },
    direcciones: [
      { id: 'd1', nombre: 'Casa', direccion: 'Residencial Villa Fontana, Calle Principal, Casa 12', referencia: null, ciudad: 'Managua', departamento: 'Managua', pais: 'Nicaragua', codigo_postal: '10000', tipo: 'residencial', lat: 12.1098, lng: -86.2718, predeterminada: true, costo_delivery: null, created_at: ahora },
      { id: 'd2', nombre: 'Trabajo', direccion: 'Av. Bolívar, Edificio Torre 2', referencia: 'Piso 4, recepción', ciudad: 'Managua', departamento: 'Managua', pais: 'Nicaragua', codigo_postal: '10000', tipo: 'trabajo', lat: 12.1440, lng: -86.2708, predeterminada: false, costo_delivery: null, created_at: ahora },
    ],
    favoritos: [
      { codigo: 'GG001', nombre: 'Super-Star', marca: 'Golden Goose', precio: 525, imagen: null, created_at: ahora },
      { codigo: 'AC001', nombre: 'T-shirt Logo', marca: 'Acne Studios', precio: 275, imagen: null, created_at: ahora },
      { codigo: 'RB001', nombre: 'Wayfarer', marca: 'Ray-Ban', precio: 165, imagen: null, created_at: ahora },
    ],
    entregas: {},
  }
}
function demoLeer(): DemoState {
  try { const raw = localStorage.getItem(DEMO_KEY); if (raw) return { ...demoInicial(), ...JSON.parse(raw) } } catch { /* sin storage */ }
  return demoInicial()
}
function demoGuardar(state: DemoState) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)) } catch { /* sin storage */ } }
function demoMutar(fn: (state: DemoState) => void) { const state = demoLeer(); fn(state); demoGuardar(state); return state }

/* ------------------------------------ Cuenta ------------------------------------ */
export async function obtenerCuenta(): Promise<CuentaCliente> {
  if (esDemo) return demoLeer().cuenta
  const { data, error } = await db().rpc('mi_cuenta_cliente')
  if (error) throw error
  return data as CuentaCliente
}

export async function actualizarCuenta(cambios: Partial<Pick<CuentaCliente, 'nombre' | 'telefono' | 'avatar_path' | 'idioma' | 'moneda'>>) {
  if (esDemo) { demoMutar((s) => { s.cuenta = { ...s.cuenta, ...cambios } }); return }
  const { data: { user } } = await db().auth.getUser()
  if (!user) throw new Error('Tu sesión expiró. Volvé a ingresar.')
  const { error } = await db().from('cuentas_cliente').update({ ...cambios, updated_at: new Date().toISOString() }).eq('user_id', user.id)
  if (error) throw error
}

export function urlAvatar(path: string | null | undefined) {
  if (!path) return null
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return supabase ? supabase.storage.from('avatares').getPublicUrl(path).data.publicUrl : null
}

export async function subirAvatar(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usá una foto JPG, PNG o WebP.')
  if (file.size > 3 * 1024 * 1024) throw new Error('La foto pesa más de 3 MB.')
  if (esDemo) {
    const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file) })
    await actualizarCuenta({ avatar_path: dataUrl })
    return dataUrl
  }
  const { data: { user } } = await db().auth.getUser()
  if (!user) throw new Error('Tu sesión expiró. Volvé a ingresar.')
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  // Nombre nuevo en cada subida: evita que la CDN muestre la foto vieja en caché.
  const path = `${user.id}/avatar-${Date.now()}.${ext}`
  const { error } = await db().storage.from('avatares').upload(path, file, { contentType: file.type, upsert: true })
  if (error) throw error
  await actualizarCuenta({ avatar_path: path })
  return path
}

/* ---------------------------------- Direcciones --------------------------------- */
const ORDEN_DIR = (a: Direccion, b: Direccion) => Number(b.predeterminada) - Number(a.predeterminada) || (a.created_at ?? '').localeCompare(b.created_at ?? '')

export async function listarDirecciones(): Promise<Direccion[]> {
  if (esDemo) return [...demoLeer().direcciones].sort(ORDEN_DIR)
  const { data, error } = await db().from('direcciones_cliente').select('*').order('predeterminada', { ascending: false }).order('created_at')
  if (error) throw error
  return (data ?? []) as Direccion[]
}

export async function guardarDireccion(input: DireccionInput, id?: string): Promise<Direccion> {
  const limpio: DireccionInput = {
    ...input,
    nombre: input.nombre.trim(), direccion: input.direccion.trim(), ciudad: input.ciudad.trim(), pais: input.pais.trim() || 'Nicaragua',
    referencia: input.referencia?.trim() || null, departamento: input.departamento?.trim() || null, codigo_postal: input.codigo_postal?.trim() || null,
  }
  if (esDemo) {
    let guardada!: Direccion
    demoMutar((s) => {
      if (limpio.predeterminada) s.direcciones = s.direcciones.map((d) => ({ ...d, predeterminada: false }))
      if (id) { s.direcciones = s.direcciones.map((d) => d.id === id ? (guardada = { ...d, ...limpio }) : d) }
      else { guardada = { ...limpio, id: `d${Date.now()}`, costo_delivery: null, created_at: new Date().toISOString(), predeterminada: limpio.predeterminada || s.direcciones.length === 0 }; s.direcciones.push(guardada) }
      if (!s.direcciones.some((d) => d.predeterminada) && s.direcciones[0]) s.direcciones[0].predeterminada = true
    })
    return guardada
  }
  const query = id
    ? db().from('direcciones_cliente').update({ ...limpio, updated_at: new Date().toISOString() }).eq('id', id)
    : db().from('direcciones_cliente').insert(limpio)
  const { data, error } = await query.select('*').single()
  if (error) throw new Error(error.message.includes('10 direcciones') ? 'Podés guardar hasta 10 direcciones.' : 'No se pudo guardar la dirección.')
  return data as Direccion
}

export async function eliminarDireccion(id: string) {
  if (esDemo) {
    demoMutar((s) => {
      const borrada = s.direcciones.find((d) => d.id === id)
      s.direcciones = s.direcciones.filter((d) => d.id !== id)
      if (borrada?.predeterminada && s.direcciones[0]) s.direcciones[0].predeterminada = true
    })
    return
  }
  const { error } = await db().from('direcciones_cliente').delete().eq('id', id)
  if (error) throw error
}

export async function hacerPredeterminada(id: string) {
  if (esDemo) { demoMutar((s) => { s.direcciones = s.direcciones.map((d) => ({ ...d, predeterminada: d.id === id })) }); return }
  const { error } = await db().from('direcciones_cliente').update({ predeterminada: true }).eq('id', id)
  if (error) throw error
}

export async function listarTarifas(): Promise<Tarifa[]> {
  if (esDemo) return [{ zona: 'Managua', costo: 8, moneda: 'USD' }]
  const { data, error } = await db().from('tarifas_delivery').select('zona, costo, moneda').eq('activo', true)
  if (error) throw error
  return (data ?? []) as Tarifa[]
}

const norm = (v: string | null | undefined) => (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Costo de delivery de una dirección: el que fijó el admin para ESA dirección, si no la
// tarifa de su zona (departamento en Nicaragua). null = "a cotizar por WhatsApp".
export function costoDelivery(dir: Pick<Direccion, 'costo_delivery' | 'departamento' | 'ciudad' | 'pais'> | null | undefined, tarifas: Tarifa[]): number | null {
  if (!dir) return null
  if (dir.costo_delivery != null) return Number(dir.costo_delivery)
  if (norm(dir.pais) !== 'nicaragua') return null
  const zona = norm(dir.departamento) || norm(dir.ciudad)
  const tarifa = tarifas.find((t) => norm(t.zona) === zona)
  return tarifa ? Number(tarifa.costo) : null
}

/* -------------------------------- Lista de deseos -------------------------------- */
export async function listarFavoritos(): Promise<Favorito[]> {
  if (esDemo) return demoLeer().favoritos
  const { data, error } = await db().from('favoritos_cliente').select('codigo, nombre, marca, precio, imagen, created_at').order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Favorito[]
}

export async function agregarFavorito(fav: Omit<Favorito, 'created_at'>) {
  if (esDemo) { demoMutar((s) => { s.favoritos = [{ ...fav, created_at: new Date().toISOString() }, ...s.favoritos.filter((f) => f.codigo !== fav.codigo)] }); return }
  const { error } = await db().from('favoritos_cliente').upsert(fav, { onConflict: 'user_id,codigo', ignoreDuplicates: true })
  if (error) throw error
}

export async function quitarFavorito(codigo: string) {
  if (esDemo) { demoMutar((s) => { s.favoritos = s.favoritos.filter((f) => f.codigo !== codigo) }); return }
  const { error } = await db().from('favoritos_cliente').delete().eq('codigo', codigo)
  if (error) throw error
}

/* ------------------------------------- Pedidos ----------------------------------- */
export async function listarMisPedidos(): Promise<PedidoCuenta[]> {
  if (esDemo) {
    const entregas = demoLeer().entregas
    return DEMO_PEDIDOS.filter((p) => p.estado !== 'incidencia').map((p) => {
      const item = p.pedido_items?.[0]
      return { codigo: p.codigo, estado_codigo: p.estado, fecha_pedido: p.fecha_pedido, fecha_estimada: p.fecha_estimada, total: p.total, saldo: p.saldo, moneda: p.moneda ?? 'USD', entrega_solicitada_at: entregas[p.codigo]?.solicitada_at ?? null, items: p.pedido_items?.length ?? 0, producto: item?.producto ?? null, marca: item?.marca ?? null, talla: item?.talla ?? null, color: item?.color ?? null, imagen: item?.imagen ?? null }
    })
  }
  const { data, error } = await db().rpc('mis_pedidos_cliente')
  if (error) throw error
  return (Array.isArray(data) ? data : []) as PedidoCuenta[]
}

export async function vincularPedido(codigo: string): Promise<boolean> {
  const code = codigo.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (!/^HS\d{6}$/.test(code)) return false
  if (esDemo) return DEMO_PEDIDOS.some((p) => p.codigo === code)
  const { data, error } = await db().rpc('vincular_pedido_cliente', { p_codigo: code })
  if (error) throw error
  return Boolean(data)
}

export async function obtenerEntrega(codigo: string): Promise<EntregaPedido | null> {
  if (esDemo) return demoLeer().entregas[codigo] ?? null
  const { data, error } = await db().rpc('entrega_pedido_cliente', { p_codigo: codigo })
  if (error) throw error
  return (data as EntregaPedido | null) ?? null
}

export async function solicitarEntrega(codigo: string, direccion: Direccion, tarifas: Tarifa[]): Promise<EntregaPedido> {
  if (esDemo) {
    await new Promise((r) => setTimeout(r, 900))
    const entrega: EntregaPedido = { solicitada_at: new Date().toISOString(), direccion, costo: costoDelivery(direccion, tarifas) }
    demoMutar((s) => { s.entregas[codigo] = entrega })
    return entrega
  }
  const { data, error } = await db().rpc('solicitar_entrega_pedido', { p_codigo: codigo, p_direccion_id: direccion.id })
  if (error) throw new Error(error.message || 'No se pudo solicitar el envío.')
  return data as EntregaPedido
}

/* ------------------------------------ Utilidades ------------------------------------ */
// Agrupa los 8+ estados internos en las 3 etapas que ve el cliente en "Mis pedidos".
export type EtapaCliente = 'proceso' | 'enviado' | 'entregado' | 'cancelado'
export function etapaCliente(estado: EstadoPedido): EtapaCliente {
  const base = etapaBase(estado)
  if (base === 'entregado') return 'entregado'
  if (base === 'cancelado') return 'cancelado'
  if (base === 'pedido_confirmado' || base === 'en_preparacion' || base === 'control_calidad') return 'proceso'
  return 'enviado'
}
export const disponibleParaEntrega = (estado: EstadoPedido) => estado === 'disponible_entrega' || estado === 'pagado'

export function formatoMonto(valor: number | null | undefined, moneda = 'USD') {
  if (valor == null) return '—'
  return `${moneda === 'NIO' ? 'C$' : 'USD'} ${Number(valor).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatoFecha(fecha: string | null | undefined) {
  if (!fecha) return ''
  const d = new Date(fecha.length === 10 ? `${fecha}T12:00:00` : fecha)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('es-NI', { day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace('.', '')
}

export function lineasDireccion(dir: DireccionSnapshot) {
  const ciudad = [dir.ciudad, dir.departamento && norm(dir.departamento) !== norm(dir.ciudad) ? dir.departamento : null].filter(Boolean).join(', ')
  return [dir.direccion, dir.referencia, `${ciudad}, ${dir.pais}`, dir.codigo_postal ? `CP: ${dir.codigo_postal}` : null].filter(Boolean) as string[]
}

export function mensajeSolicitudEnvio(codigo: string, dir: DireccionSnapshot, costo: number | null) {
  const mapa = dir.lat != null && dir.lng != null ? `\nUbicación: https://maps.google.com/?q=${dir.lat.toFixed(6)},${dir.lng.toFixed(6)}` : ''
  return `Hola, quiero solicitar el envío de mi pedido #${codigo} a la dirección registrada. ¿Podrían confirmar la entrega?\n\n📍 ${dir.nombre}\n${lineasDireccion(dir).join('\n')}${mapa}\nDelivery: ${costo != null ? formatoMonto(costo) : 'a cotizar'}`
}
