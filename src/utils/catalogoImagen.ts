// Las fotos del catálogo se guardan como RUTA RELATIVA (p.ej. "imgP/.../1.jpg"), no
// como URL. En la página de seguimiento pública, un <img src="imgP/..."> se resolvería
// contra el dominio del tracking (donde ese archivo no existe) y saldría rota. Aquí la
// volvemos absoluta contra el dominio del catálogo. Las que ya son absolutas
// (http/https, storage de Supabase) o data: se dejan igual. Espejo de
// `absolutizarImagen` en api/_correo.js. Base configurable con VITE_CATALOGO_BASE_URL.
const BASE = (import.meta.env.VITE_CATALOGO_BASE_URL ?? 'https://hauslineshopni.es/').replace(/\/$/, '')

export function resolverImagenCatalogo(src: string | null | undefined): string {
  const s = String(src ?? '').trim()
  if (!s) return ''
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  // Codifica espacios/acentos de la ruta (preservando las barras). Espejo del arreglo en
  // api/_correo.js: evita URLs con espacios que ni el navegador ni los proxies cargan bien.
  const ruta = s
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => (/%[0-9a-f]{2}/i.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/')
  return `${BASE}/${ruta}`
}
