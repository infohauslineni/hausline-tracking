import { supabase } from '../lib/supabase'
import type { Cliente, Pedido } from '../types/domain'
import { calcularCargoBodega, type CargoBodega } from '../utils/bodega'
import { costoEnvioPedido, lineasDireccion, tarifasDelivery, urlMapa, type CostoEnvioPedido, type DireccionCliente } from './direccionesCliente.service'
import { adjuntarFotosCatalogo, esPagaAlRecibir } from './pedidos.service'

// ENTREGAS: los pedidos que ya se pueden entregar (disponibles, pagados o empaquetados) con
// todo lo que hace falta para coordinarlos sin abrir pedido por pedido: a dónde va, cuánto
// se cobra (saldo + envío + bodega) y si ya se le avisó al cliente.

// Lugar de entrega de un pedido, en orden de prioridad:
//   1. La dirección a la que el cliente pidió el envío desde la tienda (entrega_direccion).
//   2. Sus direcciones guardadas en Mi cuenta (la predeterminada primero).
//   3. Lo que quedó en su ficha de cliente (departamento / ciudad / dirección del registro).
export type LugarEntrega = { titulo: string; lineas: string[]; mapa: string | null; departamento: string | null; ciudad: string | null; deFicha: boolean }

const sinAcento = (v: string | null | undefined) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
export const esManaguaLugar = (l: LugarEntrega | null) => !!l && (sinAcento(l.departamento) === 'managua' || (!l.departamento && sinAcento(l.ciudad) === 'managua'))

type ClienteLugar = Pick<Cliente, 'direccion' | 'referencia' | 'ciudad' | 'departamento'>
export function lugaresEntrega(pedido: Pick<Pedido, 'entrega_direccion'>, cliente: Partial<ClienteLugar> | null, direcciones: DireccionCliente[]): LugarEntrega[] {
  const out: LugarEntrega[] = []
  const e = pedido.entrega_direccion
  if (e) out.push({ titulo: 'Pidió el envío a esta dirección', lineas: [e.nombre, ...lineasDireccion({ direccion: e.direccion, referencia: e.referencia ?? null, ciudad: e.ciudad, departamento: e.departamento ?? null, pais: e.pais, codigo_postal: e.codigo_postal ?? null })], mapa: urlMapa({ lat: e.lat ?? null, lng: e.lng ?? null }), departamento: e.departamento ?? null, ciudad: e.ciudad, deFicha: false })
  for (const d of direcciones) out.push({ titulo: `Guardada en Mi cuenta${d.predeterminada ? ' · principal' : ''}`, lineas: [d.nombre, ...lineasDireccion(d)], mapa: urlMapa(d), departamento: d.departamento, ciudad: d.ciudad, deFicha: false })
  if (cliente && (cliente.direccion || cliente.ciudad || cliente.departamento)) {
    const ciudad = [cliente.ciudad, cliente.departamento && sinAcento(cliente.departamento) !== sinAcento(cliente.ciudad) ? cliente.departamento : null].filter(Boolean).join(', ')
    out.push({ titulo: 'De su ficha de cliente', lineas: [cliente.direccion, cliente.referencia, ciudad].filter(Boolean) as string[], mapa: null, departamento: cliente.departamento ?? null, ciudad: cliente.ciudad ?? null, deFicha: true })
  }
  return out
}

type ClienteEntrega = Pick<Cliente, 'id' | 'nombre' | 'whatsapp' | 'correo' | 'departamento' | 'ciudad' | 'direccion' | 'referencia' | 'costo_envio'> & { user_id: string | null }
export type Entrega = {
  pedido: Pedido
  cliente: ClienteEntrega | null
  lugar: LugarEntrega | null
  managua: boolean
  envio: CostoEnvioPedido | null
  /** Desde cuándo está "Disponible para entrega" (primer paso por esa etapa). */
  disponibleDesde: string | null
  /** Cargo por bodega acumulado (solo mientras sigue en "Disponible" y no paga al recibir). */
  bodega: CargoBodega | null
  alRecibir: boolean
  /** Lo que falta del pedido (saldo) + envío que no está en el pedido + bodega. */
  cobrar: { saldo: number; envio: number; bodega: number; total: number }
}

export const ESTADOS_ENTREGA = ['disponible_entrega', 'pagado', 'empaquetado'] as const

export async function listarEntregas(tipoCambio: number): Promise<Entrega[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('pedidos')
    .select('*, clientes(id, nombre, whatsapp, correo, user_id, departamento, ciudad, direccion, referencia, costo_envio), pedido_items(*), historial_pedidos(estado_nuevo, created_at)')
    .in('estado', [...ESTADOS_ENTREGA])
    .order('updated_at', { ascending: true })
  if (error) throw error
  type Fila = Pedido & { clientes: ClienteEntrega | ClienteEntrega[] | null; historial_pedidos?: { estado_nuevo: string; created_at: string }[] }
  const filas = (data ?? []) as unknown as Fila[]
  await adjuntarFotosCatalogo(filas.flatMap((p) => p.pedido_items ?? []))

  // Cuenta web de cada cliente: la de su ficha o, si no, la del mismo correo ya verificado.
  const clienteDe = (p: Fila) => (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) ?? null
  const clientes = filas.map(clienteDe).filter(Boolean) as ClienteEntrega[]
  const cuentaPorCorreo = new Map<string, string>()
  const correosSinCuenta = [...new Set(clientes.filter((c) => !c.user_id && c.correo).map((c) => String(c.correo).trim().toLowerCase()))]
  if (correosSinCuenta.length) {
    const { data: cuentas } = await supabase.from('cuentas_cliente').select('user_id, correo').in('correo', correosSinCuenta).not('verificada_at', 'is', null)
    for (const c of cuentas ?? []) cuentaPorCorreo.set(String(c.correo).trim().toLowerCase(), c.user_id)
  }
  const usuarioDe = (c: ClienteEntrega | null) => c?.user_id ?? (c?.correo ? cuentaPorCorreo.get(String(c.correo).trim().toLowerCase()) ?? null : null)
  const usuarios = [...new Set(clientes.map(usuarioDe).filter(Boolean))] as string[]
  const dirPorUsuario = new Map<string, DireccionCliente[]>()
  if (usuarios.length) {
    const { data: dirs } = await supabase.from('direcciones_cliente').select('*').in('user_id', usuarios)
      .order('predeterminada', { ascending: false }).order('created_at')
    for (const d of (dirs ?? []) as DireccionCliente[]) dirPorUsuario.set(d.user_id, [...(dirPorUsuario.get(d.user_id) ?? []), d])
  }
  const tarifas = await tarifasDelivery().catch(() => [])

  return filas.map((p) => {
    const cliente = clienteDe(p)
    const usuario = usuarioDe(cliente)
    const direcciones = usuario ? dirPorUsuario.get(usuario) ?? [] : []
    const lugar = lugaresEntrega(p, cliente, direcciones)[0] ?? null
    const envio = costoEnvioPedido({ ...p, clientes: cliente }, direcciones, tarifas, tipoCambio)
    const disponibleDesde = (p.historial_pedidos ?? []).filter((h) => h.estado_nuevo === 'disponible_entrega').map((h) => h.created_at).sort()[0] ?? null
    const alRecibir = esPagaAlRecibir(p)
    // La bodega solo corre mientras sigue en "Disponible" (en Pagado / Empaquetado ya quedó fija en el pedido).
    const bodega = p.estado === 'disponible_entrega' && !alRecibir ? calcularCargoBodega(disponibleDesde) : null
    const saldo = Math.max(0, Number(p.saldo || 0))
    const envioExtra = envio && !envio.incluido ? envio.costo : 0
    const cargo = bodega?.cargo ?? 0
    return {
      pedido: p as Pedido, cliente, lugar, managua: esManaguaLugar(lugar), envio, disponibleDesde, bodega, alRecibir,
      cobrar: { saldo, envio: envioExtra, bodega: cargo, total: Math.round((saldo + envioExtra + cargo) * 100) / 100 },
    }
  })
}

// "Ya le avisé": cuándo se le mandó al cliente el WhatsApp de que su pedido está disponible.
export async function marcarAvisoDisponible(pedidoId: string): Promise<string> {
  if (!supabase) throw new Error('Sin conexión')
  const ahora = new Date().toISOString()
  const { error } = await supabase.from('pedidos').update({ aviso_disponible_at: ahora }).eq('id', pedidoId)
  if (error) throw error
  return ahora
}

// "avisado hace 2 h", "avisado ayer", "avisado hace 3 días".
export function haceCuanto(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return ''
  const min = Math.max(0, Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60_000))
  if (min < 60) return min < 2 ? 'recién' : `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}
