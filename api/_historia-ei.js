// HISTORIA DIARIA DE ENTREGA INMEDIATA (1080×1920): lo que hay hoy en Nicaragua, con foto, tallas
// y precio (con el descuento si hay una promoción en la web). Hasta 4 productos por imagen; si
// hay más, salen varias. La arma la automatización de cada mañana (api/_automatico.js) y se
// manda por correo al dueño y a Drive.
// El texto se dibuja como trazos con las fuentes de la tienda (Jost y Cormorant Garamond,
// licencia OFL, en api/_fuentes): el servidor de Vercel no trae fuentes instaladas.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as fontkit from 'fontkit'
import sharp from 'sharp'
import { obtenerCatalogoMergeado } from './_catalogo.js'
import { absolutizarImagen } from './_correo.js'

const fuente = (archivo) => fontkit.create(readFileSync(new URL(`./_fuentes/${archivo}`, import.meta.url)))
let F = null
const fuentes = () => (F ??= {
  jost5: fuente('jost-latin-500-normal.woff'),
  jost6: fuente('jost-latin-600-normal.woff'),
  jost7: fuente('jost-latin-700-normal.woff'),
  serif: fuente('cormorant-garamond-latin-600-normal.woff'),
})

const W = 1080, H = 1920
const C = { fondo: '#F5F0E6', tarjeta: '#FFFFFF', tinta: '#171310', gris: '#6E6455', suave: '#9A8F7E', oro: '#A8822F', linea: '#E6DDCB', oferta: '#B3261E' }

// Ancho de un texto (px) con su espaciado entre letras.
function ancho(font, texto, size, espacio = 0) {
  const run = font.layout(String(texto))
  return run.advanceWidth * (size / font.unitsPerEm) + espacio * Math.max(0, run.glyphs.length - 1)
}
// Recorta con "…" hasta que quepa en `max` px.
function caber(font, texto, size, max, espacio = 0) {
  let t = String(texto)
  if (ancho(font, t, size, espacio) <= max) return t
  while (t.length > 1 && ancho(font, `${t}…`, size, espacio) > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}
// Texto como <path>. anchor: 'start' | 'middle' | 'end'. y = línea base.
function texto(font, str, { x, y, size, color, anchor = 'start', espacio = 0 }) {
  const s = size / font.unitsPerEm
  const run = font.layout(String(str))
  const total = ancho(font, str, size, espacio)
  let px = anchor === 'middle' ? x - total / 2 : anchor === 'end' ? x - total : x
  let d = ''
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i]
    const path = g.path.toSVG()
    if (path) d += `<path transform="translate(${(px + pos.xOffset * s).toFixed(2)} ${(y - pos.yOffset * s).toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" d="${path}"/>`
    px += pos.xAdvance * s + espacio
  })
  return `<g fill="${color}">${d}</g>`
}

// ---------- Datos: productos en Entrega inmediata con su precio de hoy ----------
async function leerPromociones() {
  try {
    const res = await fetch(`https://hauslineshopni.es/productos.js?promos=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return []
    const src = await res.text()
    const ini = src.indexOf('const PROMOCIONES')
    if (ini < 0) return []
    const a = src.indexOf('[', ini), b = src.indexOf('\n];', a)
    const lista = vm.runInNewContext(src.slice(a, b + 2), {}, { timeout: 1500 })
    return Array.isArray(lista) ? lista : []
  } catch { return [] }
}
// Mismo criterio que ofertaDe() de la tienda: oferta propia del producto o promoción general.
function descuentoDe(p, promos, ahora = new Date()) {
  const base = Number(p.precio_venta || 0)
  const oferta = Number(p.precio_oferta || 0)
  if (oferta > 0 && base > 0 && oferta < base && p.promocion_hasta && ahora < new Date(p.promocion_hasta)) return Math.round((1 - oferta / base) * 100)
  const promo = promos.find((x) => {
    if (!x.activa || !x.hasta || !(ahora < new Date(x.hasta))) return false
    if (x.desde && ahora < new Date(x.desde)) return false
    if (x.codigos) return x.codigos.includes(p.codigo)
    if (x.marca) return p.marca === x.marca
    if (x.categoria) return p.categoria === x.categoria
    return true
  })
  return promo ? Number(promo.descuento) || 0 : 0
}

export async function productosEntregaInmediata() {
  const [catalogo, promos] = await Promise.all([obtenerCatalogoMergeado(), leerPromociones()])
  return catalogo
    .filter((p) => p.entrega_inmediata === true && !/^LIB\d/i.test(String(p.codigo || '')))
    .filter((p) => (p.tallas_entrega_inmediata ?? []).length > 0 || Number(p.cantidad_disponible) > 0 || !(p.tallas ?? []).length)
    .map((p) => {
      const base = Number(p.precio_entrega_inmediata) > 0 ? Number(p.precio_entrega_inmediata) : Number(p.precio_venta || 0)
      const desc = descuentoDe(p, promos)
      return { codigo: p.codigo, nombre: p.nombre, marca: p.marca || '', imagen: p.imagen, tallas: [...new Set(p.tallas_entrega_inmediata ?? [])], base, desc, precio: desc > 0 ? Math.round(base * (1 - desc / 100)) : base }
    })
    .filter((p) => p.base > 0)
}

// ---------- Dibujo ----------
async function foto(url, w, h) {
  try {
    const res = await fetch(absolutizarImagen(url))
    if (!res.ok) return null
    return await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(w, h, { fit: 'cover', position: 'centre' }).jpeg({ quality: 88 }).toBuffer()
  } catch { return null }
}
const usd = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`

function tarjetaSvg(p, x, y, w, h, fotoH) {
  const f = fuentes()
  const cx = x + w / 2
  const pad = 26
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" fill="${C.tarjeta}"/>`
  let ty = y + fotoH + 46
  s += texto(f.jost6, caber(f.jost6, String(p.marca).toUpperCase(), 18, w - pad * 2, 3), { x: cx, y: ty, size: 18, color: C.suave, anchor: 'middle', espacio: 3 })
  ty += 38
  s += texto(f.jost6, caber(f.jost6, p.nombre, 25, w - pad * 2), { x: cx, y: ty, size: 25, color: C.tinta, anchor: 'middle' })
  ty += 38
  const tallas = p.tallas.length ? `${p.tallas.length === 1 ? 'Talla' : 'Tallas'} ${p.tallas.slice(0, 5).join(' · ')}${p.tallas.length > 5 ? ' …' : ''}` : 'Disponible'
  s += texto(f.jost5, caber(f.jost5, tallas, 22, w - pad * 2), { x: cx, y: ty, size: 22, color: C.gris, anchor: 'middle' })
  ty += 54
  if (p.desc > 0) {
    const nuevo = usd(p.precio), antes = usd(p.base)
    const wN = ancho(f.jost7, nuevo, 40), wA = ancho(f.jost5, antes, 26)
    const ini = cx - (wN + 16 + wA) / 2
    s += texto(f.jost7, nuevo, { x: ini, y: ty, size: 40, color: C.oferta })
    s += texto(f.jost5, antes, { x: ini + wN + 16, y: ty, size: 26, color: C.suave })
    s += `<rect x="${(ini + wN + 14).toFixed(1)}" y="${ty - 10}" width="${(wA + 4).toFixed(1)}" height="2.5" fill="${C.suave}"/>`
  } else {
    s += texto(f.jost7, usd(p.precio), { x: cx, y: ty, size: 40, color: C.tinta, anchor: 'middle' })
  }
  return s
}

// Una imagen con 1 a 4 productos.
async function historia(productos, { fecha, pagina, paginas }) {
  const f = fuentes()
  const n = productos.length
  // Posiciones de las tarjetas según cuántos productos hay.
  const zonaY = 470, zonaH = 1220
  let celdas
  if (n === 1) celdas = [{ x: 150, y: zonaY + 60, w: 780, h: 1080, fotoH: 780 }]
  else {
    const w = 465, h = 590, gap = 30, fotoH = 400
    const filas = Math.ceil(n / 2)
    const alto = filas * h + (filas - 1) * gap
    const y0 = zonaY + (zonaH - alto) / 2
    celdas = productos.map((_, i) => {
      const fila = Math.floor(i / 2), enFila = Math.min(2, n - fila * 2)
      const x0 = enFila === 1 ? (W - w) / 2 : 60
      return { x: x0 + (i % 2) * (w + gap), y: y0 + fila * (h + gap), w, h, fotoH }
    })
  }
  const dia = new Intl.DateTimeFormat('es-NI', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${fecha}T12:00:00Z`))
  const hayOferta = productos.some((p) => p.desc > 0)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.fondo}"/>`
  svg += texto(f.jost6, 'HAUSLINE', { x: W / 2, y: 150, size: 34, color: C.tinta, anchor: 'middle', espacio: 12 })
  svg += texto(f.jost6, hayOferta ? 'ENTREGA INMEDIATA · CON DESCUENTO' : 'ENTREGA INMEDIATA', { x: W / 2, y: 232, size: 22, color: C.oro, anchor: 'middle', espacio: 6 })
  svg += texto(f.serif, 'Disponible hoy', { x: W / 2, y: 338, size: 98, color: C.tinta, anchor: 'middle' })
  svg += texto(f.jost5, `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ya está en Nicaragua${paginas > 1 ? ` · ${pagina}/${paginas}` : ''}`, { x: W / 2, y: 402, size: 28, color: C.gris, anchor: 'middle' })
  for (let i = 0; i < n; i++) { const c = celdas[i]; svg += tarjetaSvg(productos[i], c.x, c.y, c.w, c.h, c.fotoH) }
  svg += `<rect x="${(W - 520) / 2}" y="1768" width="520" height="84" rx="42" fill="${C.tinta}"/>`
  svg += texto(f.jost6, 'hauslineshopni.es', { x: W / 2, y: 1821, size: 32, color: '#FFFFFF', anchor: 'middle', espacio: 1 })
  svg += texto(f.jost5, 'Apartalo en la web o escribinos por WhatsApp', { x: W / 2, y: 1740, size: 24, color: C.gris, anchor: 'middle' })
  svg += '</svg>'

  // Fotos (con esquinas de arriba redondeadas) encima del fondo.
  const capas = []
  for (let i = 0; i < n; i++) {
    const c = celdas[i]
    const img = await foto(productos[i].imagen, c.w, c.fotoH)
    if (!img) continue
    const mascara = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${c.w}" height="${c.fotoH}"><path d="M0 30 Q0 0 30 0 H${c.w - 30} Q${c.w} 0 ${c.w} 30 V${c.fotoH} H0 Z" fill="#fff"/></svg>`)
    const recortada = await sharp(img).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer()
    capas.push({ input: recortada, left: Math.round(c.x), top: Math.round(c.y) })
  }
  // El SVG tiene las tarjetas; las fotos van encima y la etiqueta de descuento encima de todo.
  const base = await sharp(Buffer.from(svg)).composite(capas).png().toBuffer()
  const badges = productos.map((p, i) => p.desc > 0 ? celdas[i] : null).filter(Boolean)
  if (!badges.length) return sharp(base).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  let extra = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  productos.forEach((p, i) => { if (p.desc > 0) { const c = celdas[i]; extra += `<rect x="${c.x + 22}" y="${c.y + 22}" width="104" height="48" rx="24" fill="${C.oferta}"/>` + texto(f.jost7, `-${p.desc}%`, { x: c.x + 74, y: c.y + 55, size: 26, color: '#FFFFFF', anchor: 'middle' }) } })
  extra += '</svg>'
  return sharp(base).composite([{ input: Buffer.from(extra) }]).jpeg({ quality: 90, mozjpeg: true }).toBuffer()
}

// Arma todas las historias del día (4 productos por imagen). Devuelve [{ filename, data }].
export async function historiasEntregaInmediata(fecha) {
  const productos = await productosEntregaInmediata()
  if (!productos.length) return { productos: [], imagenes: [] }
  const grupos = []
  for (let i = 0; i < productos.length; i += 4) grupos.push(productos.slice(i, i + 4))
  const imagenes = []
  for (let g = 0; g < grupos.length; g++) {
    const data = await historia(grupos[g], { fecha, pagina: g + 1, paginas: grupos.length })
    imagenes.push({ filename: `Entrega inmediata ${fecha}${grupos.length > 1 ? ` (${g + 1} de ${grupos.length})` : ''}.jpg`, data })
  }
  return { productos, imagenes }
}
