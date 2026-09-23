import { ExternalLink, Heart, MoreHorizontal, Share2, ShoppingCart, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CuentaShell, Hoja } from '../../components/cuenta/CuentaShell'
import { FotoProducto } from '../../components/cuenta/piezas'
import { agregarFavorito, formatoMonto, listarFavoritos, quitarFavorito, TIENDA_URL, type Favorito } from '../../services/cuentaCliente.service'

const urlProducto = (codigo: string) => `${TIENDA_URL}/p/${encodeURIComponent(codigo)}`

// La tienda (otro dominio) guarda un favorito mandando al cliente a
// /cuenta/favoritos?agregar=CODIGO&nombre=…&marca=…&precio=…&img=…  (si no hay sesión, pasa
// primero por el ingreso y vuelve aquí). Solo aceptamos imágenes del catálogo propio.
function favoritoDesdeUrl(params: URLSearchParams): Omit<Favorito, 'created_at'> | null {
  const codigo = (params.get('agregar') ?? '').trim().slice(0, 40)
  const nombre = (params.get('nombre') ?? '').trim().slice(0, 200)
  if (!codigo || !/^[A-Za-z0-9_-]+$/.test(codigo) || !nombre) return null
  const precio = Number(params.get('precio'))
  const img = (params.get('img') ?? '').trim()
  const imgValida = img && (!/^[a-z]+:/i.test(img) || img.startsWith(`${TIENDA_URL}/`)) ? img.slice(0, 600) : null
  return { codigo, nombre, marca: (params.get('marca') ?? '').trim().slice(0, 80) || null, precio: Number.isFinite(precio) && precio > 0 ? precio : null, imagen: imgValida }
}

export function CuentaFavoritosPage() {
  const [favoritos, setFavoritos] = useState<Favorito[] | null>(null)
  const [menu, setMenu] = useState<Favorito | null>(null)
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const procesado = useRef(false)

  const cargar = useCallback(() => listarFavoritos().then(setFavoritos).catch(() => { setFavoritos([]); toast.error('No pudimos cargar tu lista de deseos.') }), [])
  useEffect(() => {
    const nuevo = favoritoDesdeUrl(params)
    if (nuevo && !procesado.current) {
      procesado.current = true
      setParams({}, { replace: true })
      void agregarFavorito(nuevo).then(() => toast.success('Guardado en tu lista de deseos.')).catch(() => toast.error('No se pudo guardar el favorito.')).finally(() => void cargar())
      return
    }
    void cargar()
  }, [cargar, params, setParams])

  const quitar = async (fav: Favorito) => {
    setMenu(null)
    setFavoritos((prev) => prev?.filter((f) => f.codigo !== fav.codigo) ?? null)
    try {
      await quitarFavorito(fav.codigo)
      toast('Quitado de tu lista de deseos.', { action: { label: 'Deshacer', onClick: () => void agregarFavorito(fav).then(cargar) } })
    } catch { toast.error('No se pudo quitar.'); void cargar() }
  }
  const compartir = async (fav: Favorito) => {
    setMenu(null)
    const url = urlProducto(fav.codigo)
    try {
      if (navigator.share) await navigator.share({ title: `${fav.marca ?? ''} ${fav.nombre}`.trim(), url })
      else { await navigator.clipboard.writeText(url); toast.success('Enlace copiado.') }
    } catch { /* el cliente canceló */ }
  }

  return <CuentaShell titulo="Lista de deseos" subtitulo="Tus productos favoritos, siempre a mano." volver="/cuenta" accion={<a href={TIENDA_URL} className="hsc-iconbtn -mr-2" aria-label="Ir a la tienda"><ShoppingCart size={20} strokeWidth={1.7} /></a>}>
    <div className="mt-4 space-y-2.5">
      {favoritos === null
        ? [0, 1, 2].map((i) => <div key={i} className="hsp-card h-[118px] animate-pulse" />)
        : favoritos.length === 0
          ? <div className="hsp-card p-8 text-center">
              <Heart size={26} strokeWidth={1.4} className="hsp-faint mx-auto" />
              <p className="mt-3 text-[14px] font-semibold">Tu lista de deseos está vacía</p>
              <p className="hsp-muted mx-auto mt-1 max-w-xs text-[12px] leading-5">Tocá el corazón en cualquier producto de la tienda para guardarlo aquí.</p>
              <button type="button" onClick={() => { window.location.href = TIENDA_URL }} className="hsp-btn mt-5 h-11 min-h-0 text-[13px]">Explorar la tienda</button>
            </div>
          : favoritos.map((f, i) => <article key={f.codigo} className="hsp-card hsp-rise flex gap-3.5 p-3" style={{ animationDelay: `${i * 35}ms` }}>
              <a href={urlProducto(f.codigo)} className="shrink-0"><FotoProducto src={f.imagen} tam={96} /></a>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start gap-2">
                  <a href={urlProducto(f.codigo)} className="min-w-0 flex-1">
                    {f.marca && <strong className="block truncate text-[14px]">{f.marca}</strong>}
                    <span className="hsp-muted block truncate text-[12px]">{f.nombre}</span>
                  </a>
                  <button type="button" onClick={() => void quitar(f)} className="hsc-iconbtn -mr-1 -mt-1 shrink-0" aria-label="Quitar de favoritos"><Heart size={19} fill="currentColor" /></button>
                </div>
                <span className="mt-1 text-[14px] font-medium" style={{ color: 'var(--ink)' }}>{f.precio != null ? formatoMonto(f.precio) : 'Precio a consultar'}</span>
                <div className="mt-auto flex items-center gap-2 pt-2">
                  <a href={urlProducto(f.codigo)} className="hsc-cartbtn">Agregar al carrito</a>
                  <span className="flex-1" />
                  <button type="button" onClick={() => setMenu(f)} className="hsc-iconbtn -mr-1" aria-label="Más opciones"><MoreHorizontal size={19} /></button>
                </div>
              </div>
            </article>)}
    </div>

    <Hoja abierta={menu !== null} onCerrar={() => setMenu(null)} titulo={menu ? `${menu.marca ?? ''} ${menu.nombre}`.trim() : undefined}>
      {menu && <div className="hsp-card hsp-divide overflow-hidden">
        <button type="button" className="hsc-row w-full" onClick={() => { setMenu(null); window.location.href = urlProducto(menu.codigo) }}><span className="hsc-row__icon"><ExternalLink size={18} /></span><span className="flex-1 text-left text-[14px]">Ver producto</span></button>
        <button type="button" className="hsc-row w-full" onClick={() => void compartir(menu)}><span className="hsc-row__icon"><Share2 size={18} /></span><span className="flex-1 text-left text-[14px]">Compartir</span></button>
        <button type="button" className="hsc-row w-full" onClick={() => void quitar(menu)}><span className="hsc-row__icon" style={{ color: '#b91c1c' }}><Trash2 size={18} /></span><span className="flex-1 text-left text-[14px]" style={{ color: '#b91c1c' }}>Quitar de la lista</span></button>
      </div>}
      <button type="button" onClick={() => { setMenu(null); navigate('/cuenta/favoritos') }} className="hsp-btn--ghost mt-2 w-full">Cancelar</button>
    </Hoja>
  </CuentaShell>
}
