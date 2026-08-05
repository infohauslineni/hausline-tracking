import { supabase } from '../lib/supabase'
import type { ArchivoPedido, TipoArchivo } from '../types/domain'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

function requireSupabase() { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase }
export function validarImagen(file: File) { if (!ALLOWED.includes(file.type)) throw new Error('Usa una imagen JPG, PNG o WEBP.'); if (file.size > MAX_BYTES) throw new Error('La imagen no puede superar 10 MB.') }

export type MarcaImagen = boolean | 'esquina' | { sello: string }

// Decide qué marca aplicar según la categoría de la foto.
export function marcaParaTipo(tipo: TipoArchivo, codigo?: string): MarcaImagen {
  if (tipo === 'recibido_local') return { sello: (codigo ?? '').toUpperCase() }
  if (tipo === 'recepcion_miami') return 'esquina'
  return tipo === 'control_calidad' || tipo === 'producto'
}

export async function comprimirImagen(file: File, marcaDeAgua: MarcaImagen = false): Promise<Blob> {
  validarImagen(file)
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url })
    const max = 1920
    const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    context?.drawImage(image, 0, 0, canvas.width, canvas.height)
    if (context && typeof marcaDeAgua === 'object') dibujarSelloRecepcion(context, canvas.width, canvas.height, marcaDeAgua.sello)
    else if (context && marcaDeAgua === 'esquina') dibujarMarcaDeAguaEsquina(context, canvas.width, canvas.height)
    else if (context && marcaDeAgua) dibujarMarcaDeAgua(context, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', .84))
    return blob ?? file
  } finally { URL.revokeObjectURL(url) }
}

// Sello tipo comprobante de recepción: barra inferior con "RECIBIDO", código y fecha/hora.
function dibujarSelloRecepcion(context: CanvasRenderingContext2D, width: number, height: number, codigo: string) {
  const shortest = Math.min(width, height)
  const fontSize = Math.max(15, Math.round(shortest * .034))
  const pad = Math.round(fontSize * .7)
  const barH = Math.round(fontSize * 2.9)
  const fecha = new Intl.DateTimeFormat('es-NI', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
  context.save()
  // Barra semitransparente al pie de la imagen.
  context.fillStyle = 'rgba(8,10,9,.72)'
  context.fillRect(0, height - barH, width, barH)
  context.fillStyle = '#b7ff00'
  context.fillRect(0, height - barH, Math.max(4, Math.round(fontSize * .35)), barH)
  // "RECIBIDO ✓"
  context.textBaseline = 'middle'
  context.textAlign = 'left'
  context.font = `800 ${fontSize}px Arial, sans-serif`
  context.fillStyle = '#b7ff00'
  const titulo = '✓ RECIBIDO'
  context.fillText(titulo, pad * 1.6, height - barH + barH * .34)
  // Código del pedido + fecha
  context.font = `600 ${Math.round(fontSize * .78)}px Arial, sans-serif`
  context.fillStyle = 'rgba(255,255,255,.9)'
  const detalle = [codigo, fecha].filter(Boolean).join('  ·  ')
  context.fillText(detalle, pad * 1.6, height - barH + barH * .7)
  // Marca a la derecha
  context.textAlign = 'right'
  context.font = `800 ${Math.round(fontSize * .82)}px Arial, sans-serif`
  context.fillStyle = 'rgba(255,255,255,.7)'
  context.fillText('HAUSLINE.NI', width - pad * 1.6, height - barH / 2)
  context.restore()
}

function dibujarMarcaDeAguaEsquina(context: CanvasRenderingContext2D, width: number, height: number) {
  const shortest = Math.min(width, height)
  const fontSize = Math.max(16, Math.round(shortest * .035))
  const padding = Math.max(10, Math.round(fontSize * .7))
  const label = 'HAUSLINE.NI'
  context.save()
  context.font = `800 ${fontSize}px Arial, sans-serif`
  context.textAlign = 'right'
  context.textBaseline = 'bottom'
  const labelWidth = context.measureText(label).width
  context.fillStyle = 'rgba(0,0,0,.42)'
  context.fillRect(width - labelWidth - padding * 2, height - fontSize - padding * 1.6, labelWidth + padding * 2, fontSize + padding * 1.6)
  context.fillStyle = 'rgba(255,255,255,.76)'
  context.fillText(label, width - padding, height - padding * .55)
  context.restore()
}

function dibujarMarcaDeAgua(context: CanvasRenderingContext2D, width: number, height: number) {
  const shortest = Math.min(width, height)
  const fontSize = Math.max(22, Math.round(shortest * .055))
  context.save()
  context.fillStyle = 'rgba(255,255,255,.28)'
  context.strokeStyle = 'rgba(0,0,0,.12)'
  context.lineWidth = Math.max(1, fontSize * .045)
  context.font = `800 ${fontSize}px Arial, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.translate(width / 2, height / 2)
  context.rotate(-Math.PI / 7)
  const spacingX = Math.max(250, fontSize * 6.8)
  const spacingY = Math.max(130, fontSize * 3.4)
  for (let y = -height; y <= height; y += spacingY) {
    for (let x = -width; x <= width; x += spacingX) {
      context.strokeText('HAUSLINE.NI', x, y)
      context.fillText('HAUSLINE.NI', x, y)
    }
  }
  context.restore()
}

export async function listarArchivos(pedidoId: string) {
  const client = requireSupabase()
  const { data, error } = await client.from('archivos_pedido').select('*').eq('pedido_id', pedidoId).order('tipo').order('orden')
  if (error) throw error
  const files = data as ArchivoPedido[]
  const paths = files.map((file) => file.storage_path)
  if (!paths.length) return files
  const { data: signed } = await client.storage.from('pedidos').createSignedUrls(paths, 3600)
  return files.map((file, index) => ({ ...file, signed_url: signed?.[index]?.signedUrl ?? undefined }))
}

export async function subirArchivo(pedidoId: string, tipo: TipoArchivo, file: File, visibleCliente: boolean, codigo?: string) {
  const client = requireSupabase()
  const blob = await comprimirImagen(file, marcaParaTipo(tipo, codigo))
  const path = `pedidos/${pedidoId}/${tipo === 'control_calidad' ? 'control-calidad' : tipo === 'comprobante' ? 'comprobantes' : tipo}/${crypto.randomUUID()}.webp`
  const { error: uploadError } = await client.storage.from('pedidos').upload(path, blob, { contentType: 'image/webp', upsert: false })
  if (uploadError) throw uploadError
  const { data, error } = await client.from('archivos_pedido').insert({ pedido_id: pedidoId, tipo, storage_path: path, nombre: file.name, mime_type: 'image/webp', tamano_bytes: blob.size, visible_cliente: visibleCliente }).select().single()
  if (error) { await client.storage.from('pedidos').remove([path]); throw error }
  const { data: signed } = await client.storage.from('pedidos').createSignedUrl(path, 3600)
  return { ...(data as ArchivoPedido), signed_url: signed?.signedUrl ?? undefined }
}

export async function eliminarArchivo(file: ArchivoPedido) { const client = requireSupabase(); const { error: storageError } = await client.storage.from('pedidos').remove([file.storage_path]); if (storageError) throw storageError; const { error } = await client.from('archivos_pedido').delete().eq('id', file.id); if (error) throw error }
export async function marcarPrincipal(file: ArchivoPedido) { const client = requireSupabase(); await client.from('archivos_pedido').update({ es_principal: false }).eq('pedido_id', file.pedido_id); const { error } = await client.from('archivos_pedido').update({ es_principal: true }).eq('id', file.id); if (error) throw error; await client.from('pedidos').update({ imagen_principal: file.storage_path }).eq('id', file.pedido_id) }
