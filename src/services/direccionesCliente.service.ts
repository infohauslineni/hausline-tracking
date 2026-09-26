import { supabase } from '../lib/supabase'

// Direcciones que el cliente guardó en Mi cuenta (tienda), con su pin del mapa. El personal
// las lee y les puede fijar un costo de delivery propio (direcciones_cliente.costo_delivery,
// tiene prioridad sobre la tarifa de su departamento). RLS: usuario_activo().
export type DireccionCliente = {
  id: string
  user_id: string
  nombre: string
  direccion: string
  referencia: string | null
  ciudad: string
  departamento: string | null
  pais: string
  codigo_postal: string | null
  tipo: 'residencial' | 'trabajo' | 'otro'
  lat: number | null
  lng: number | null
  predeterminada: boolean
  costo_delivery: number | null
}
export type TarifaDelivery = { zona: string; costo: number; moneda: 'USD' | 'NIO' }
export type CostoDelivery = { costo: number; moneda: 'USD' | 'NIO'; fuente: 'direccion' | 'zona'; zona?: string }

// La cuenta del cliente: la asociada en su ficha (clientes.user_id) o, si no, la cuenta con el
// MISMO correo ya verificado (igual que decide la tienda qué pedidos le muestra).
export async function direccionesDeCliente(clienteId: string): Promise<{ tieneCuenta: boolean; direcciones: DireccionCliente[] }> {
  if (!supabase) return { tieneCuenta: false, direcciones: [] }
  const { data: cliente } = await supabase.from('clientes').select('user_id, correo').eq('id', clienteId).maybeSingle()
  let userId: string | null = cliente?.user_id ?? null
  const correo = String(cliente?.correo ?? '').trim().toLowerCase()
  if (!userId && correo) {
    const { data } = await supabase.from('cuentas_cliente').select('user_id').eq('correo', correo).not('verificada_at', 'is', null).limit(1)
    userId = data?.[0]?.user_id ?? null
  }
  if (!userId) return { tieneCuenta: false, direcciones: [] }
  const { data, error } = await supabase.from('direcciones_cliente').select('*').eq('user_id', userId)
    .order('predeterminada', { ascending: false }).order('created_at')
  if (error) throw error
  return { tieneCuenta: true, direcciones: (data ?? []) as DireccionCliente[] }
}

export async function tarifasDelivery(): Promise<TarifaDelivery[]> {
  if (!supabase) return []
  const { data } = await supabase.from('tarifas_delivery').select('zona, costo, moneda').eq('activo', true)
  return (data ?? []) as TarifaDelivery[]
}

export async function fijarCostoDireccion(id: string, costo: number | null): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('direcciones_cliente').update({ costo_delivery: costo }).eq('id', id)
  if (error) throw error
}

const sinAcento = (v: string | null | undefined) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

// Mismo cálculo que ve el cliente en Mi cuenta: costo fijado para esa dirección; si no, la
// tarifa de su departamento (solo Nicaragua). null = "a cotizar".
export function costoDelivery(d: DireccionCliente, tarifas: TarifaDelivery[]): CostoDelivery | null {
  if (d.costo_delivery != null) return { costo: Number(d.costo_delivery), moneda: 'USD', fuente: 'direccion' }
  if (sinAcento(d.pais) !== 'nicaragua') return null
  const zona = sinAcento(d.departamento) || sinAcento(d.ciudad)
  const t = tarifas.find((x) => sinAcento(x.zona) === zona)
  return t ? { costo: Number(t.costo), moneda: t.moneda, fuente: 'zona', zona: t.zona } : null
}

export function lineasDireccion(d: Pick<DireccionCliente, 'direccion' | 'referencia' | 'ciudad' | 'departamento' | 'pais' | 'codigo_postal'>) {
  const ciudad = [d.ciudad, d.departamento && sinAcento(d.departamento) !== sinAcento(d.ciudad) ? d.departamento : null].filter(Boolean).join(', ')
  return [d.direccion, d.referencia, `${ciudad}, ${d.pais}`, d.codigo_postal ? `CP: ${d.codigo_postal}` : null].filter(Boolean) as string[]
}

export function urlMapa(d: { lat: number | null; lng: number | null }) {
  return d.lat != null && d.lng != null ? `https://www.google.com/maps?q=${Number(d.lat).toFixed(6)},${Number(d.lng).toFixed(6)}` : null
}
