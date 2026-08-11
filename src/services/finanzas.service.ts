import { supabase } from '../lib/supabase'
import type { ConfiguracionFinanzas, GananciaRealizada, MetaCompra } from '../types/domain'

export const DEFAULT_FINANZAS: ConfiguracionFinanzas = { dia_inicio_mes: 1, dia_retiro: 28, porcentaje_reserva_negocio: 30 }
function client() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }

export function periodoComercial(fecha = new Date(), diaInicio = 1) {
  const y = fecha.getFullYear(), m = fecha.getMonth(), day = fecha.getDate()
  const start = day >= diaInicio ? new Date(y, m, diaInicio) : new Date(y, m - 1, diaInicio)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, diaInicio - 1)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return { desde: iso(start), hasta: iso(end) }
}

export async function obtenerConfiguracionFinanzas() {
  const { data, error } = await client().from('configuracion').select('valor_json').eq('clave','finanzas').maybeSingle()
  if (error) throw error
  return { ...DEFAULT_FINANZAS, ...((data?.valor_json as Partial<ConfiguracionFinanzas> | null) ?? {}) }
}
export async function guardarConfiguracionFinanzas(value: ConfiguracionFinanzas) { const { error } = await client().from('configuracion').upsert({ clave:'finanzas', valor_json:value }, { onConflict:'clave' }); if (error) throw error }
export async function obtenerGananciaRealizada(desde: string, hasta: string) { const { data, error } = await client().rpc('obtener_ganancia_realizada',{ p_desde:desde, p_hasta:hasta }); if(error) throw error; const v=data as Partial<GananciaRealizada>; return { desde, hasta, pedidos_entregados:Number(v.pedidos_entregados??0), cobrado:Number(v.cobrado??0), costos:Number(v.costos??0), ganancia_realizada:Number(v.ganancia_realizada??0), ganancia_asignada:Number(v.ganancia_asignada??0), ganancia_disponible:Number(v.ganancia_disponible??0) } }
export async function obtenerGananciaDisponibleActual(){ const config=await obtenerConfiguracionFinanzas(); const period=periodoComercial(new Date(),config.dia_inicio_mes); return obtenerGananciaRealizada(period.desde,period.hasta) }
export async function listarMetasCompra(){ const {data,error}=await client().from('metas_compra').select('*').neq('estado','cancelada').order('created_at',{ascending:false}); if(error) throw error; return data as MetaCompra[] }
export async function crearMetaCompra(input: Omit<MetaCompra,'id'|'monto_reservado'|'estado'|'created_at'>){ const {data,error}=await client().from('metas_compra').insert({...input,monto_reservado:0,estado:'activa'}).select('*').single(); if(error) throw error; return data as MetaCompra }
export async function actualizarMetaCompra(id:string,input:Pick<MetaCompra,'nombre'|'monto_objetivo'|'fecha_objetivo'|'notas'>){ const {data,error}=await client().from('metas_compra').update(input).eq('id',id).select('*').single(); if(error) throw error; return data as MetaCompra }
export async function eliminarMetaCompra(id:string){ const {error}=await client().from('metas_compra').delete().eq('id',id); if(error) throw error }
export async function aportarMeta(meta:MetaCompra,monto:number,fecha:string){ if(monto<=0) throw new Error('Indica un monto válido.'); const available=await obtenerGananciaDisponibleActual(); if(monto>available.ganancia_disponible) throw new Error(`Solo tienes USD ${available.ganancia_disponible.toFixed(2)} de ganancia disponible.`); const aporte=Math.min(monto,Number(meta.monto_objetivo)-Number(meta.monto_reservado)); const nuevo=Number(meta.monto_reservado)+aporte; const {error}=await client().from('metas_compra').update({monto_reservado:nuevo,estado:nuevo>=Number(meta.monto_objetivo)?'completada':'activa'}).eq('id',meta.id); if(error) throw error; const {error:a}=await client().from('asignaciones_ganancia').insert({fecha,tipo:'meta_compra',monto:aporte,descripcion:`Fondo para ${meta.nombre}`,meta_id:meta.id}); if(a) throw a }
// Saldo real disponible en la cuenta: suma firmada de todos los movimientos (dinero que de
// verdad hay en caja), independiente de la ganancia contable.
export async function obtenerSaldoCuenta(){ const {data,error}=await client().rpc('obtener_resumen_comercial',{p_desde:null,p_hasta:null}); if(error) throw error; return Number((data as {saldo_cuenta?:number}|null)?.saldo_cuenta ?? 0) }
export async function retirarGanancia(monto:number,fecha:string,descripcion='Retiro de ganancia mensual'){ const [available,saldo]=await Promise.all([obtenerGananciaDisponibleActual(),obtenerSaldoCuenta()]); if(monto<=0||monto>available.ganancia_disponible) throw new Error(`Solo tienes USD ${available.ganancia_disponible.toFixed(2)} de ganancia disponible.`); if(monto>saldo+0.005) throw new Error(`Solo hay USD ${saldo.toFixed(2)} en la cuenta. No puedes retirar más de lo que realmente tienes en caja.`); const {error}=await client().from('asignaciones_ganancia').insert({fecha,tipo:'retiro_salario',monto,descripcion}); if(error) throw error; const {error:m}=await client().from('movimientos_cuenta').insert({fecha:`${fecha}T12:00:00`,tipo:'retiro',descripcion,monto,metodo:null,observaciones:'Retiro proveniente únicamente de ganancia realizada'}); if(m) throw m }
