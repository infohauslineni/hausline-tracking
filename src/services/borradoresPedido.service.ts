import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { EleccionEnvio } from '../constants/cargotrans'

// PEDIDOS EN BORRADOR: el pedido armado (cliente, productos, envío) que todavía NO existe porque
// el cliente no ha depositado ("mañana le deposito"). No cuenta en ventas, caja ni estados. Desde
// el borrador se le manda la cotización o el mensaje de "esperamos su pago". Cuando deposita se
// abre el borrador, se registra el abono y se guarda: el pedido nace ESE día (fecha del depósito).
// Se guardan en `configuracion` (clave borradores_pedido) para verlos desde el teléfono y la
// computadora sin tocar la tabla de pedidos.

const CLAVE = 'borradores_pedido'
export type PagoBorrador = '50' | 'total'
export type BorradorPedido = {
  id: string
  creado: string // ISO
  actualizado: string
  clienteId: string
  clienteNombre: string
  clienteWhatsapp: string | null
  total: number // con envío, sin abono (lo que vale el pedido)
  pago: PagoBorrador
  envio: EleccionEnvio | null
  // Lo del formulario de Nuevo pedido (productos, notas, envío rápido…) tal cual.
  valores: Record<string, unknown>
  cupon: { id?: string; codigo: string; tipo: 'porcentaje' | 'monto'; valor: number } | null
}

const LOCAL = 'hl-borradores-pedido' // vista previa (sin base de datos)

async function leerTodos(): Promise<BorradorPedido[]> {
  if (!isSupabaseConfigured || !supabase) { try { return JSON.parse(localStorage.getItem(LOCAL) ?? '[]') as BorradorPedido[] } catch { return [] } }
  const { data, error } = await supabase.from('configuracion').select('valor_json').eq('clave', CLAVE).maybeSingle()
  if (error) throw error
  const lista = (data?.valor_json as { lista?: BorradorPedido[] } | null)?.lista
  return Array.isArray(lista) ? lista : []
}
async function guardarTodos(lista: BorradorPedido[]) {
  if (!isSupabaseConfigured || !supabase) { try { localStorage.setItem(LOCAL, JSON.stringify(lista)) } catch { /* sin almacenamiento */ } return }
  const { error } = await supabase.from('configuracion').upsert({ clave: CLAVE, valor_json: { lista } }, { onConflict: 'clave' })
  if (error) throw error
}

export async function listarBorradores() {
  return (await leerTodos()).sort((a, b) => b.actualizado.localeCompare(a.actualizado))
}
export async function obtenerBorrador(id: string) {
  return (await leerTodos()).find((b) => b.id === id) ?? null
}
// Crea o actualiza (si trae id). Devuelve el id.
export async function guardarBorrador(b: Omit<BorradorPedido, 'id' | 'creado' | 'actualizado'> & { id?: string | null }) {
  const lista = await leerTodos()
  const ahora = new Date().toISOString()
  const previo = b.id ? lista.find((x) => x.id === b.id) : undefined
  const id = previo?.id ?? (globalThis.crypto?.randomUUID?.() ?? `b${Date.now().toString(36)}`)
  const nuevo: BorradorPedido = { ...b, id, creado: previo?.creado ?? ahora, actualizado: ahora }
  await guardarTodos([nuevo, ...lista.filter((x) => x.id !== id)])
  return id
}
export async function eliminarBorrador(id: string) {
  const lista = await leerTodos()
  await guardarTodos(lista.filter((x) => x.id !== id))
}
