// CORREOS QUE NO FUNCIONAN: a esas direcciones el sistema ya no les manda nada.
//   1. Antes de cada envío (transporteSmtp en _correo.js) se quitan los destinatarios que están en
//      la lista o cuyo dominio no existe (gmail.con, hotmial.com… → sin servidor de correo).
//   2. Se leen los avisos de rebote de Gmail ("Mail Delivery Subsystem", mailer-daemon) por IMAP y
//      cada dirección que rebotó para siempre entra a la lista; además se da de baja como suscriptor.
// La lista vive en `configuracion` (clave correos_no_funcionan) sin tabla propia y se ve en el
// panel (Configuración). Las copias internas (cc/bcc) y las cuentas propias nunca se bloquean.
import { createClient } from '@supabase/supabase-js'
import { promises as dns } from 'node:dns'

const CLAVE = 'correos_no_funcionan'
const norm = (c) => String(c ?? '').trim().toLowerCase()
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}
// Direcciones propias: nunca se bloquean (copias al dueño, avisos internos).
function propias() {
  return new Set([process.env.SMTP_USER, process.env.AVISO_ADMIN, process.env.SMTP_FROM].map((v) => norm(String(v ?? '').match(EMAIL)?.[0])).filter(Boolean))
}
const esPropia = (c) => propias().has(c) || c.endsWith('@hauslineshopni.es')

// ---------- La lista ----------
let cache = null // { at, mapa }
export async function leerLista(cliente = db()) {
  if (!cliente) return { lista: [], revisado_at: null }
  const { data } = await cliente.from('configuracion').select('valor_json').eq('clave', CLAVE).maybeSingle()
  const v = data?.valor_json ?? {}
  return { lista: Array.isArray(v.lista) ? v.lista : [], revisado_at: v.revisado_at ?? null, desbloqueados: v.desbloqueados && typeof v.desbloqueados === 'object' ? v.desbloqueados : {} }
}
async function bloqueados() {
  if (cache && Date.now() - cache.at < 60_000) return cache.mapa
  const { lista } = await leerLista().catch(() => ({ lista: [] }))
  cache = { at: Date.now(), mapa: new Map(lista.map((x) => [norm(x.correo), x])) }
  return cache.mapa
}
// Agrega direcciones a la lista (y las da de baja como suscriptores). Devuelve las nuevas.
// Si el dueño DESBLOQUEÓ una dirección a mano, no vuelve a entrar sola por un rebote viejo: solo
// por uno que llegó después de desbloquearla (e.fechaRebote) o si el dueño la bloquea a mano.
export async function agregarALista(entradas, extra = {}, cliente = db(), { manual = false } = {}) {
  if (!cliente) return []
  const actual = await leerLista(cliente)
  const ya = new Set(actual.lista.map((x) => norm(x.correo)))
  const desbloqueados = { ...actual.desbloqueados }
  const nuevas = []
  for (const e of entradas) {
    const correo = norm(e.correo)
    if (!correo || ya.has(correo) || esPropia(correo)) continue
    const libre = desbloqueados[correo]
    if (libre && !manual && !(e.fechaRebote && Date.parse(e.fechaRebote) > Date.parse(libre))) continue
    delete desbloqueados[correo]
    ya.add(correo); nuevas.push({ correo, motivo: e.motivo, fecha: new Date().toISOString() })
  }
  if (!nuevas.length && !extra.revisado_at) return []
  const { error } = await cliente.from('configuracion').upsert({ clave: CLAVE, valor_json: { ...actual, ...extra, desbloqueados, lista: [...actual.lista, ...nuevas] } }, { onConflict: 'clave' })
  if (error) throw new Error(error.message)
  if (nuevas.length) await cliente.from('suscriptores').update({ activo: false }).in('correo', nuevas.map((n) => n.correo))
  cache = null
  return nuevas
}
export async function quitarDeLista(correo, cliente = db()) {
  const actual = await leerLista(cliente)
  const lista = actual.lista.filter((x) => norm(x.correo) !== norm(correo))
  // Se recuerda cuándo se desbloqueó, para que un rebote viejo no la vuelva a bloquear sola.
  const desbloqueados = { ...actual.desbloqueados, [norm(correo)]: new Date().toISOString() }
  const { error } = await cliente.from('configuracion').upsert({ clave: CLAVE, valor_json: { ...actual, desbloqueados, lista } }, { onConflict: 'clave' })
  if (error) throw new Error(error.message)
  cache = null
  return lista
}

// ---------- ¿Dominio mal escrito? (hotmial.com, gmial.com, gmail.co…) ----------
// Muchos de esos dominios EXISTEN (son de otras personas): el correo "sale" sin rebotar pero nunca
// le llega al cliente. Misma regla que el aviso "¿Quiso decir…?" del panel (sugerenciaCorreo).
const DOMINIOS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com', 'live.com']
const VALIDOS = new Set(['hotmail.es', 'yahoo.es', 'outlook.es', 'live.es', 'yahoo.com.mx', 'hotmail.com.mx', 'live.com.mx', 'outlook.com.mx', 'me.com', 'msn.com', 'mac.com', 'aol.com', 'gmx.com', 'mail.com', 'proton.me', 'protonmail.com', 'ymail.com', 'hotmail.co.uk', 'yahoo.co.uk'])
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
// Devuelve el dominio correcto si el dado parece un error de tipeo; si no, null.
export function dominioMalEscrito(dominio) {
  const d = norm(dominio)
  if (!d || DOMINIOS.includes(d) || VALIDOS.has(d)) return null
  const [mejor, dist] = DOMINIOS.map((x) => [x, distancia(d, x)]).sort((a, b) => a[1] - b[1])[0]
  return dist <= 2 ? mejor : null
}

// ---------- ¿El dominio recibe correo? ----------
const dominios = new Map() // dominio → true/false (por invocación)
export async function dominioRecibeCorreo(dominio) {
  const d = norm(dominio)
  if (!d) return false
  if (dominios.has(d)) return dominios.get(d)
  const noExiste = (e) => ['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(e?.code)
  let ok = true
  try { ok = (await dns.resolveMx(d)).length > 0 }
  catch (e) {
    if (!noExiste(e)) ok = true // error pasajero de DNS: no se bloquea a nadie por eso
    else { try { ok = (await dns.resolve4(d)).length > 0 } catch (e2) { ok = !noExiste(e2) } }
  }
  dominios.set(d, ok)
  return ok
}

// ---------- Filtro antes de enviar (lo usa transporteSmtp) ----------
// Devuelve los destinatarios `to` que sí se pueden usar y los que se quitaron (con el motivo).
export async function filtrarDestinatarios(to) {
  const lista = (Array.isArray(to) ? to : [to]).filter(Boolean)
  const mapa = await bloqueados().catch(() => new Map())
  const quedan = [], quitados = [], nuevos = []
  for (const d of lista) {
    const correo = norm(typeof d === 'string' ? d.match(EMAIL)?.[0] : d.address)
    if (!correo) continue
    if (esPropia(correo)) { quedan.push(d); continue }
    if (mapa.has(correo)) { quitados.push({ correo, motivo: mapa.get(correo).motivo }); continue }
    const sugerido = dominioMalEscrito(correo.split('@')[1])
    if (sugerido) {
      const motivo = `el dominio parece mal escrito (¿${sugerido}?)`
      quitados.push({ correo, motivo }); nuevos.push({ correo, motivo }); continue
    }
    if (!(await dominioRecibeCorreo(correo.split('@')[1]).catch(() => true))) {
      const motivo = `el dominio ${correo.split('@')[1]} no existe o no recibe correo`
      quitados.push({ correo, motivo }); nuevos.push({ correo, motivo }); continue
    }
    quedan.push(d)
  }
  if (nuevos.length) await agregarALista(nuevos).catch((e) => console.error('rebotes: no se pudo anotar', e?.message))
  return { quedan, quitados }
}

// ---------- Rebotes de Gmail por IMAP ----------
// Lee los avisos de "no se entregó" de los últimos `dias` y anota las direcciones que fallaron para
// siempre. Busca en Todos, en la Papelera y en Spam (si el dueño borra el aviso igual cuenta).
// Los avisos de "retraso" y de buzón lleno (temporales, códigos 4.x.x y 5.2.2) no cuentan.
const BUSQUEDA = (dias) => `(from:mailer-daemon OR from:postmaster OR subject:"Delivery Status Notification" OR subject:undeliverable OR subject:"mail delivery failed" OR subject:"no se pudo entregar") newer_than:${Math.max(1, Math.round(dias))}d`
const motivoDeEstado = (st) => /^5\.1\.(1|6|10)$/.test(st) ? 'la dirección no existe (rebotó)' : /^5\.(1\.2|4\.4)$/.test(st) ? 'el dominio no existe (rebotó)' : 'el correo rebotó'
// Devuelve Map correo → motivo de un aviso de rebote (texto crudo del mensaje).
export function fallidosDeRebote(txt) {
  const fallidos = new Map()
  // El aviso trae el informe y DESPUÉS el correo original: solo se mira el informe (el correo
  // original puede tener cualquier palabra y no debe confundir).
  const informe = txt.split(/Content-Type:\s*(?:message\/rfc822|text\/rfc822-headers)/i)[0]
  // 1) Informe estándar de entrega (lo mandan Gmail, Outlook, Yahoo y casi todos).
  for (const bloque of informe.split(/(?=^Final-Recipient:)/im).slice(1)) {
    const correo = norm(bloque.match(/^Final-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)/im)?.[1])
    const accion = bloque.match(/^Action:\s*(\w+)/im)?.[1]?.toLowerCase()
    const estado = bloque.match(/^Status:\s*(\d\.\d{1,3}\.\d{1,3})/im)?.[1] ?? ''
    if (!correo || !/@/.test(correo)) continue
    if (accion && accion !== 'failed') continue // delayed / delivered / relayed
    if (estado && (!estado.startsWith('5.') || estado === '5.2.2')) continue // temporal o buzón lleno
    fallidos.set(correo, motivoDeEstado(estado))
  }
  if (fallidos.size) return fallidos
  // 2) Sin informe estándar: cabecera X-Failed-Recipients o la frase del aviso.
  const cabecera = txt.split(/\r?\n\r?\n/)[0] ?? ''
  const asunto = (cabecera.match(/^Subject:\s*([^\r\n]*)/im)?.[1] ?? '')
  if (/delay|retras|demor/i.test(asunto)) return fallidos
  if (/\b5\.2\.2\b|\b4\.\d\.\d\b|quota|mailbox (is )?full|buz[oó]n (est[aá] )?lleno|over quota|out of storage/i.test(informe)) return fallidos
  const motivo = /5\.1\.1|does ?n.t exist|no existe|address not found|user unknown|no such user/i.test(informe) ? 'la dirección no existe (rebotó)'
    : /5\.1\.2|domain|dominio/i.test(informe) ? 'el dominio no existe (rebotó)' : 'el correo rebotó'
  const xfr = cabecera.match(/^X-Failed-Recipients:\s*([^\r\n]+(?:\r?\n[ \t][^\r\n]+)*)/im)
  if (xfr) for (const c of xfr[1].match(EMAIL) ?? []) fallidos.set(norm(c), motivo)
  if (!fallidos.size) {
    const re = /(?:wasn'?t delivered to|was not delivered to|failed permanently:|could not be delivered to|no se (?:ha )?(?:podido )?entreg(?:ó|ado|ar) (?:el mensaje )?a)\s*<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi
    for (const m of informe.matchAll(re)) fallidos.set(norm(m[1]), motivo)
  }
  return fallidos
}

export async function revisarRebotes({ dias = 3, max = 150 } = {}) {
  const cliente = db()
  if (!cliente || !process.env.SMTP_USER || !process.env.SMTP_PASS) return { revisados: 0, nuevos: [] }
  const { ImapFlow } = await import('imapflow')
  const imap = new ImapFlow({
    host: process.env.IMAP_HOST ?? 'imap.gmail.com', port: 993, secure: true, logger: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  const encontrados = new Map() // correo → { motivo, fechaRebote }
  let revisados = 0
  await imap.connect()
  try {
    const buzones = await imap.list()
    const carpeta = (uso, defecto) => buzones.find((b) => b.specialUse === uso)?.path ?? defecto
    const carpetas = [...new Set([carpeta('\\All', '[Gmail]/All Mail'), carpeta('\\Trash', null), carpeta('\\Junk', null)].filter(Boolean))]
    for (const caja of carpetas) {
      let lock
      try { lock = await imap.getMailboxLock(caja) } catch { continue }
      try {
        const uids = await imap.search({ gmraw: BUSQUEDA(dias) }, { uid: true })
        const ultimos = (uids || []).slice(-max)
        if (!ultimos.length) continue
        for await (const msg of imap.fetch(ultimos, { uid: true, internalDate: true, source: { maxLength: 64000 } }, { uid: true })) {
          revisados++
          const txt = msg.source ? msg.source.toString('utf8') : ''
          const fechaRebote = msg.internalDate ? new Date(msg.internalDate).toISOString() : new Date().toISOString()
          for (const [c, motivo] of fallidosDeRebote(txt)) {
            if (esPropia(c)) continue
            const previo = encontrados.get(c)
            if (!previo || previo.fechaRebote < fechaRebote) encontrados.set(c, { motivo, fechaRebote })
          }
        }
      } finally { lock.release() }
    }
  } finally { await imap.logout().catch(() => undefined) }
  const nuevos = await agregarALista([...encontrados].map(([correo, x]) => ({ correo, ...x })), { revisado_at: new Date().toISOString() }, cliente)
  return { revisados, nuevos }
}

// Revisión completa (botón del panel): rebotes de los últimos 60 días + todos los correos de
// clientes y suscriptores cuyo dominio no existe.
export async function revisionCompleta() {
  const cliente = db()
  const imap = await revisarRebotes({ dias: 60, max: 200 }).catch((e) => { console.error('rebotes: IMAP falló', e?.message); return { revisados: 0, nuevos: [], error: e?.message } })
  const [{ data: clientes }, { data: subs }] = await Promise.all([
    cliente.from('clientes').select('correo').not('correo', 'is', null).limit(10000),
    cliente.from('suscriptores').select('correo').limit(10000),
  ])
  const correos = [...new Set([...(clientes ?? []), ...(subs ?? [])].map((x) => norm(x.correo)).filter((c) => /@/.test(c)))]
  const porDominio = new Map()
  for (const c of correos) { const d = c.split('@')[1]; porDominio.set(d, [...(porDominio.get(d) ?? []), c]) }
  const malos = []
  await Promise.all([...porDominio.keys()].map(async (d) => {
    const sugerido = dominioMalEscrito(d)
    if (sugerido) { for (const c of porDominio.get(d)) malos.push({ correo: c, motivo: `el dominio parece mal escrito (¿${sugerido}?)` }); return }
    if (!(await dominioRecibeCorreo(d).catch(() => true))) for (const c of porDominio.get(d)) malos.push({ correo: c, motivo: `el dominio ${d} no existe o no recibe correo` })
  }))
  const nuevosDominio = await agregarALista(malos, {}, cliente)
  return { revisadosImap: imap.revisados, errorImap: imap.error ?? null, nuevos: [...imap.nuevos, ...nuevosDominio], correosRevisados: correos.length, dominios: porDominio.size }
}
