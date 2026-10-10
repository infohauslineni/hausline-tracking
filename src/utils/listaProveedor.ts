import type { Pedido } from '../types/domain'
import { resolverImagenCatalogo } from './catalogoImagen'
import { sinEmojis } from './whatsapp'

// LISTA DE COMPRA PARA EL PROVEEDOR: junta los productos de los pedidos confirmados que todavía
// no se le han comprado, en un solo mensaje (ORDER CODE / PRODUCT CODE / SIZE / QTY, en inglés
// como el mensaje por pedido) y en hojas con la FOTO de cada producto para mandarlas juntas.

// Talla de calzado (número 35–50, con o sin media) → se manda como "40EUR" al proveedor.
export function tallaProveedor(talla: string | null | undefined): string {
  const t = (talla || '').trim()
  if (!t) return 'N/A'
  const n = Number(t.replace(',', '.'))
  if (/^\d{2}([.,]5)?$/.test(t) && n >= 35 && n <= 50) return `${t}EUR`
  return t
}

// WhatsApp del proveedor: número guardado (localStorage) o VITE_PROVEEDOR_WHATSAPP; si no hay,
// abre WhatsApp para elegir el contacto con el mensaje ya escrito.
export function urlProveedor(mensaje: string): string {
  let num = ''
  try { num = (localStorage.getItem('hausline_proveedor_wa') || '').replace(/\D/g, '') } catch { /* */ }
  const env = ((import.meta.env.VITE_PROVEEDOR_WHATSAPP as string | undefined) || '').replace(/\D/g, '')
  const phone = num || env
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(sinEmojis(mensaje))}` : `https://wa.me/?text=${encodeURIComponent(sinEmojis(mensaje))}`
}

// Marca en notas_internas: este pedido ya se incluyó en una lista enviada al proveedor.
export const MARCA_LISTA_PROVEEDOR = '[EN_LISTA_PROVEEDOR]'
export const yaEnListaProveedor = (pedido: Pick<Pedido, 'notas_internas'>) => (pedido.notas_internas ?? '').includes(MARCA_LISTA_PROVEEDOR)

export type LineaCompra = {
  clave: string // pedido + índice del producto
  pedidoId: string
  pedido: string // código HS…
  cliente: string
  codigo: string // código del producto
  producto: string
  talla: string
  color: string | null
  cantidad: number
  imagen: string | null
}

const esEnvio = (producto: string | null | undefined, notas: string | null | undefined) => /^env[íi]o\b/i.test(producto ?? '') || /env[íi]o r[áa]pido/i.test(notas ?? '')

// Pedidos "Orden confirmada" = ya pagaron el abono y todavía no se le compró al proveedor.
export function lineasDeCompra(pedidos: Pedido[]): LineaCompra[] {
  return pedidos
    .filter((p) => p.estado === 'pedido_confirmado')
    .sort((a, b) => String(a.fecha_pedido).localeCompare(String(b.fecha_pedido)))
    .flatMap((p) => (p.pedido_items ?? [])
      .filter((it) => !esEnvio(it.producto, it.notas))
      .map((it, i) => ({
        clave: `${p.id}:${i}`, pedidoId: p.id, pedido: p.codigo, cliente: p.clientes?.nombre ?? '',
        codigo: (it.codigo_producto ?? '').trim().toUpperCase(), producto: it.producto, talla: tallaProveedor(it.talla),
        color: (it.color ?? '').trim() || null, cantidad: Number(it.cantidad || 1), imagen: it.imagen ?? null,
      })))
}

// Mensaje de texto: un bloque por producto, con el MISMO número que lleva su foto en las hojas
// (así el proveedor relaciona "#3" del mensaje con la foto 3).
export function mensajeListaProveedor(lineas: LineaCompra[]): string {
  const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)
  const fecha = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(new Date())
  const bloques = lineas.map((l, i) => [`#${i + 1}  ORDER CODE: ${l.pedido}`, `PRODUCT CODE: ${l.codigo || l.producto}`, `SIZE: ${l.talla}`, l.color ? `COLOR: ${l.color}` : null, `QTY: ${l.cantidad}`].filter(Boolean).join('\n'))
  return [`PURCHASE LIST - ${fecha} - ${unidades} ${unidades === 1 ? 'item' : 'items'}`, ...bloques].join('\n\n')
}

function cargar(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async'
    img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src
  })
}

function recortar(ctx: CanvasRenderingContext2D, t: string, max: number) {
  if (ctx.measureText(t).width <= max) return t
  while (t.length > 3 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

const POR_HOJA = 6 // 2 columnas × 3 filas

// Hojas 1080×1620 con la foto de cada producto y, debajo, código, talla, cantidad y pedido.
// Fondo blanco y letra grande: es para que el proveedor lo lea rápido, no lleva marca ni precios.
export async function generarHojasProveedor(lineas: LineaCompra[]): Promise<Blob[]> {
  const hojas: Blob[] = []
  const total = Math.max(1, Math.ceil(lineas.length / POR_HOJA))
  const W = 1080, H = 1620, M = 40, CAB = 110, GAP = 24
  const cw = (W - 2 * M - GAP) / 2, ch = (H - CAB - M - 2 * GAP) / 3
  const FOTO = 270
  for (let h = 0; h < total; h++) {
    const grupo = lineas.slice(h * POR_HOJA, (h + 1) * POR_HOJA)
    const fotos = await Promise.all(grupo.map((l) => l.imagen ? cargar(resolverImagenCatalogo(l.imagen)) : Promise.resolve(null)))
    const dibujar = (conFotos: boolean) => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H
      const ctx = cv.getContext('2d')!
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#111111'; ctx.font = '700 40px Arial, Helvetica, sans-serif'; ctx.textBaseline = 'alphabetic'
      ctx.fillText('PURCHASE LIST', M, 70)
      ctx.font = '500 26px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#666666'; ctx.textAlign = 'right'
      ctx.fillText(`${new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())}  ·  ${h + 1}/${total}`, W - M, 70)
      ctx.textAlign = 'left'
      grupo.forEach((l, i) => {
        const x = M + (i % 2) * (cw + GAP), y = CAB + Math.floor(i / 2) * (ch + GAP)
        ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 2; ctx.strokeRect(x, y, cw, ch)
        // Foto (contenida, sin recortar) sobre gris muy claro.
        const fx = x + 16, fy = y + 16, fw = cw - 32
        ctx.fillStyle = '#f3f3f3'; ctx.fillRect(fx, fy, fw, FOTO)
        const img = conFotos ? fotos[i] : null
        if (img) {
          const esc = Math.min(fw / img.naturalWidth, FOTO / img.naturalHeight)
          const dw = img.naturalWidth * esc, dh = img.naturalHeight * esc
          ctx.drawImage(img, fx + (fw - dw) / 2, fy + (FOTO - dh) / 2, dw, dh)
        } else { ctx.fillStyle = '#999999'; ctx.font = '500 24px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('NO PHOTO', fx + fw / 2, fy + FOTO / 2 + 8); ctx.textAlign = 'left' }
        // Número de renglón, para referirse a él ("item 3").
        ctx.fillStyle = '#111111'; ctx.fillRect(fx, fy, 54, 46)
        ctx.fillStyle = '#ffffff'; ctx.font = '700 28px Arial, Helvetica, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(h * POR_HOJA + i + 1), fx + 27, fy + 34); ctx.textAlign = 'left'
        let ty = fy + FOTO + 50
        ctx.fillStyle = '#111111'; ctx.font = '700 40px Arial, Helvetica, sans-serif'
        ctx.fillText(recortar(ctx, l.codigo || l.producto, fw), fx, ty)
        ty += 46; ctx.font = '700 34px Arial, Helvetica, sans-serif'
        ctx.fillText(`SIZE: ${l.talla}`, fx, ty)
        ctx.textAlign = 'right'; ctx.fillText(`QTY: ${l.cantidad}`, fx + fw, ty); ctx.textAlign = 'left'
        if (l.color) { ty += 36; ctx.font = '500 26px Arial, Helvetica, sans-serif'; ctx.fillText(recortar(ctx, `COLOR: ${l.color}`, fw), fx, ty) }
        ty += 36; ctx.font = '500 24px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#666666'
        ctx.fillText(`ORDER: ${l.pedido}`, fx, ty)
      })
      return new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la hoja'))), 'image/jpeg', 0.9))
    }
    // Si alguna foto "ensucia" el canvas (host sin CORS), se rehace la hoja sin fotos.
    try { hojas.push(await dibujar(true)) } catch { hojas.push(await dibujar(false)) }
  }
  return hojas
}
