import { isSupabaseConfigured, supabase } from '../lib/supabase'

// Aviso silencioso de lo que le pasa al cliente en el seguimiento público (/pedido/:codigo).
// Se guarda en eventos_cliente (RPC registrar_evento_cliente) y el panel lo muestra en
// "Salud de clientes": así nos enteramos de un fallo aunque el cliente no diga nada.
// Nunca interrumpe la página: si falla, no pasa nada. El personal del panel no se registra
// (la RPC lo descarta), para no mezclar pruebas internas con clientes reales.
const enviados = new Set<string>()
let visita = ''
function idVisita() {
  if (visita) return visita
  try {
    visita = sessionStorage.getItem('hausline_visita') || ''
    if (!visita) { visita = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('hausline_visita', visita) }
  } catch { visita = Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }
  return visita
}

function dispositivo() {
  const ua = navigator.userAgent || ''
  const so = /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : 'Otro'
  const nav = /Instagram/.test(ua) ? 'Instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook' : /EdgA?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Otro'
  return `${so} · ${nav} · ${window.innerWidth || 0}px`
}

export function registrarEventoCliente(nombre: string, o: { tipo?: 'error' | 'evento'; mensaje?: string | null; detalle?: Record<string, unknown> | null } = {}) {
  if (!isSupabaseConfigured || !supabase) return
  const mensaje = o.mensaje ? String(o.mensaje).slice(0, 500) : null
  const clave = `${nombre}|${mensaje ?? ''}`
  if (enviados.has(clave) || enviados.size >= 25) return
  enviados.add(clave)
  void Promise.resolve(supabase.rpc('registrar_evento_cliente', {
    p_origen: 'seguimiento', p_tipo: o.tipo === 'error' ? 'error' : 'evento', p_nombre: nombre,
    p_pagina: (location.pathname + location.search).slice(0, 300), p_mensaje: mensaje, p_detalle: o.detalle ?? null,
    p_visita: idVisita(), p_dispositivo: dispositivo(),
  })).catch(() => undefined)
}

export function mensajeDeError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}
