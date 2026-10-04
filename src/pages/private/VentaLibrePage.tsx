import { LibresTabs } from '../../components/layout/LibresTabs'
import { Copy, ExternalLink, ImagePlus, Link2, MessageCircle, Plus, Power, Star, Store, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { useAuth } from '../../contexts/AuthContext'
import {
  borrarVentaLibre, cambiarActivoVentaLibre, conectadoATienda, conectarTienda, guardarVentaLibre, linkVentaLibre, listarVentasLibres,
  mensajeVentaLibre, publicarEnTienda, siguienteCodigo, type DatosVentaLibre, type FotoVentaLibre, type VentaLibre,
} from '../../services/ventaLibre.service'

// Mismas categorías que admin.html de la tienda.
const CATEGORIAS = ['Hombre', 'Dama', 'Unisex', 'Accesorios', 'Decoración']
const SUBCATEGORIAS: Record<string, string[]> = { Hombre: ['Calzado', 'Ropa'], Dama: ['Calzado', 'Ropa'], Unisex: ['Calzado', 'Ropa'], Accesorios: ['Hombre', 'Dama'], 'Decoración': [] }
const TALLAS_RAPIDAS: [string, string][] = [['Calzado 38–45', '38, 39, 40, 41, 42, 43, 44, 45'], ['Ropa S–XL', 'S, M, L, XL'], ['Sin talla', '']]

// WhatsApp del cliente por venta libre: solo en este equipo (los datos del producto son públicos,
// así que el teléfono del cliente NO se guarda ahí).
const CLAVE_WA = 'hausline_venta_libre_wa'
const leerWa = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(CLAVE_WA) || '{}') } catch { return {} } }
const guardarWa = (codigo: string, wa: string) => { try { const m = leerWa(); if (wa) m[codigo] = wa; else delete m[codigo]; localStorage.setItem(CLAVE_WA, JSON.stringify(m)) } catch { /* sin almacenamiento */ } }
function urlWhatsApp(datos: Pick<DatosVentaLibre, 'codigo' | 'nombre' | 'precio'>, wa?: string) {
  let num = String(wa || '').replace(/\D/g, '')
  if (num.length === 8) num = '505' + num
  return `https://wa.me/${num}?text=${encodeURIComponent(mensajeVentaLibre(datos))}`
}

export function VentaLibrePage() {
  const { user } = useAuth()
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [lista, setLista] = useState<VentaLibre[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<VentaLibre | null>(null)
  const [listo, setListo] = useState<{ datos: DatosVentaLibre; wa: string } | null>(null)

  const load = () => {
    setLoading(true)
    void listarVentasLibres().then(setLista).catch((e: Error) => { toast.error(e.message); if (/venció/.test(e.message)) setConectado(false) }).finally(() => setLoading(false))
  }
  useEffect(() => { void conectadoATienda().then((ok) => { setConectado(ok); if (ok) load(); else setLoading(false) }) }, [])

  const copiar = async (texto: string) => { try { await navigator.clipboard.writeText(texto); toast.success('Link copiado.') } catch { toast.error('No se pudo copiar.') } }
  const accion = async (fn: () => Promise<void>, ok: string) => { try { await fn(); toast.success(ok); load() } catch (e) { toast.error(e instanceof Error ? e.message : 'No se pudo.') } }
  const publicar = (v: VentaLibre) => { if (window.confirm(`¿Publicar ${v.datos.nombre} en la tienda? Va a salir en el catálogo, la búsqueda y “Nuevo” como cualquier producto. El link que ya mandaste sigue funcionando.`)) void accion(() => publicarEnTienda(v), 'Publicado en la tienda. Ya no aparece en esta lista.') }
  const borrar = (v: VentaLibre) => { if (window.confirm(`¿Borrar la venta libre ${v.codigo}? El link deja de funcionar. Los encargos que ya hizo el cliente no se tocan.`)) void accion(() => borrarVentaLibre(v), 'Venta libre borrada.') }

  return <div><LibresTabs />
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="eyebrow">Clientes y productos</p><h1 className="page-title">Venta libre</h1><p className="page-subtitle">Un cliente pide algo que no está en la tienda: subís la foto, le mandás el link y lo encarga igual que en la web. No sale en la tienda hasta que vos lo publiqués.</p></div>
      {conectado && <button className="primary-button shrink-0 whitespace-nowrap px-5" onClick={() => { setEditing(null); setOpen(true) }}><Plus size={18} /> Crear venta libre</button>}
    </div>

    {conectado === false && <ConectarTienda email={user?.email ?? ''} onOk={() => { setConectado(true); load() }} />}

    {listo && <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/[0.05] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">✓ Link listo para {listo.datos.nombre}</h2><p className="mt-1 text-xs text-muted">Mandáselo al cliente: abre el producto, elige talla y lo encarga como en la web (te cae en Encargos web).</p></div><button className="icon-button shrink-0" onClick={() => setListo(null)} aria-label="Cerrar"><X size={16} /></button></div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input readOnly value={linkVentaLibre(listo.datos.codigo)} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 font-mono text-sm" />
        <button className="subtle-button px-4" onClick={() => void copiar(linkVentaLibre(listo.datos.codigo))}><Copy size={16} /> Copiar link</button>
        <a className="primary-button px-4" href={urlWhatsApp(listo.datos, listo.wa)} target="_blank" rel="noreferrer"><MessageCircle size={16} /> {listo.wa ? 'Enviar al cliente' : 'Enviar por WhatsApp'}</a>
      </div>
      <p className="mt-2 text-[11px] text-muted">El link funciona desde ya. La vista previa con foto al pegarlo en WhatsApp aparece en unos 15 minutos.</p>
    </div>}

    {conectado && (loading ? <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="h-44 animate-pulse rounded-2xl border border-line bg-panel" />)}</div>
      : lista.length === 0 ? <div className="mt-8 grid min-h-64 place-items-center rounded-2xl border border-dashed border-line text-center"><div><Link2 className="mx-auto text-muted" /><h2 className="mt-3 font-semibold">Sin ventas libres todavía</h2><p className="mt-1 text-sm text-muted">Cuando un cliente pida algo que no tenés en la tienda, creale su link acá.</p><button onClick={() => { setEditing(null); setOpen(true) }} className="primary-button mx-auto mt-5 px-5"><Plus size={17} /> Crear venta libre</button></div></div>
      : <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{lista.map((v) => {
          const d = v.datos
          const wa = leerWa()[v.codigo]
          return <article key={v.id} className={`rounded-2xl border p-4 ${v.activo ? 'border-line bg-panel' : 'border-line bg-panel/50 opacity-70'}`}>
            <div className="flex gap-3">
              {d.imagen ? <img src={d.imagen} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-white object-cover" /> : <div className="h-20 w-20 shrink-0 rounded-xl bg-white/[0.06]" />}
              <div className="min-w-0">
                <strong className="line-clamp-2 text-sm">{d.nombre}</strong>
                <p className="mt-1 font-mono text-xs text-muted">{v.codigo}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{Number(d.precio) > 0 ? `US$ ${Number(d.precio).toFixed(2)}` : 'A consultar'}</span>
                  <span className={`rounded-full px-2 py-0.5 ${v.activo ? 'bg-accent/10 text-accent' : 'bg-red-400/10 text-red-300'}`}>{v.activo ? 'Link activo' : 'Link pausado'}</span>
                  {d.fecha && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-muted">{String(d.fecha)}</span>}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t border-line pt-3">
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => void copiar(linkVentaLibre(v.codigo))}><Copy size={14} /> Link</button>
              <a className="subtle-button px-3 py-1.5 text-xs text-accent" href={urlWhatsApp({ ...d, codigo: v.codigo }, wa)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>
              <a className="subtle-button px-3 py-1.5 text-xs" href={linkVentaLibre(v.codigo)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Ver</a>
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => { setEditing(v); setOpen(true) }}>Editar</button>
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => void accion(() => cambiarActivoVentaLibre(v), v.activo ? 'Link pausado.' : 'Link activado.')}><Power size={14} /> {v.activo ? 'Pausar' : 'Activar'}</button>
              <button className="subtle-button px-3 py-1.5 text-xs" onClick={() => publicar(v)}><Store size={14} /> Publicar en tienda</button>
              <button className="table-action table-action-danger" onClick={() => borrar(v)} aria-label="Borrar"><Trash2 size={16} /></button>
            </div>
          </article>
        })}</div>)}

    <VentaLibreModal open={open} venta={editing} onClose={() => setOpen(false)} onSaved={(datos, wa) => { setOpen(false); setListo({ datos, wa }); load(); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
  </div>
}

function ConectarTienda({ email: inicial, onOk }: { email: string; onOk: () => void }) {
  const [email, setEmail] = useState(inicial)
  const [password, setPassword] = useState('')
  const [enviando, setEnviando] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setEnviando(true)
    try { await conectarTienda(email.trim(), password); toast.success('Conectado con la tienda.'); onOk() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo conectar.') } finally { setEnviando(false) }
  }
  return <form onSubmit={(e) => void submit(e)} className="mt-6 max-w-lg rounded-2xl border border-line bg-panel p-5">
    <h2 className="font-semibold">Conectar con la tienda</h2>
    <p className="mt-1 text-xs text-muted">Las ventas libres se guardan en el catálogo de la tienda (el mismo del panel de productos). Entrá una sola vez con tu usuario de la tienda; queda guardado en este equipo.</p>
    <div className="form-grid mt-4">
      <label className="form-field sm:col-span-2"><span>Correo</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
      <label className="form-field sm:col-span-2"><span>Contraseña</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
    </div>
    <div className="mt-4 flex justify-end"><button className="primary-button px-5" disabled={enviando || !email || !password}>{enviando ? 'Conectando…' : 'Conectar'}</button></div>
  </form>
}

function VentaLibreModal({ open, venta, onClose, onSaved }: { open: boolean; venta: VentaLibre | null; onClose: () => void; onSaved: (d: DatosVentaLibre, wa: string) => void }) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [marca, setMarca] = useState('')
  const [categoria, setCategoria] = useState('Hombre')
  const [subcategoria, setSubcategoria] = useState('Calzado')
  const [precio, setPrecio] = useState('')
  const [tallas, setTallas] = useState('')
  const [colores, setColores] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [wa, setWa] = useState('')
  const [fotos, setFotos] = useState<FotoVentaLibre[]>([])
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const d = venta?.datos
    setNombre(d?.nombre ?? ''); setMarca(String(d?.marca ?? '')); setCategoria(d?.categoria || 'Hombre'); setSubcategoria(String(d?.subcategoria ?? 'Calzado'))
    setPrecio(d && Number(d.precio) > 0 ? String(d.precio) : ''); setTallas((d?.tallas ?? []).join(', ')); setColores((d?.colores ?? []).join(', ')); setDescripcion(String(d?.descripcion ?? ''))
    setFotos((d?.imagenes ?? []).filter(Boolean).map((url) => ({ url }))); setWa(venta ? leerWa()[venta.codigo] ?? '' : '')
    if (venta) setCodigo(venta.codigo)
    else { setCodigo(''); void siguienteCodigo().then(setCodigo).catch(() => setCodigo('LIB001')) }
  }, [open, venta])

  const agregarFotos = (files: FileList | null) => {
    const nuevas = Array.from(files ?? []).filter((f) => f.type.startsWith('image/')).map((file) => ({ file, url: URL.createObjectURL(file) }))
    setFotos((x) => [...x, ...nuevas].slice(0, 8))
  }
  const subs = SUBCATEGORIAS[categoria] ?? []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!fotos.length) return toast.error('Subí al menos una foto: es lo que ve el cliente en el link.')
    if (nombre.trim().length < 2) return toast.error('Poné el nombre del producto.')
    if (!(Number(precio) > 0)) return toast.error('Poné el precio en US$.')
    if (!/^[A-Z0-9-]{3,20}$/.test(codigo.trim().toUpperCase())) return toast.error('El código solo puede tener letras, números y guion (ej. LIB001).')
    setSaving(true)
    try {
      const lista = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
      const datos = await guardarVentaLibre({
        codigo, nombre: nombre.trim(), marca: marca.trim(), categoria, subcategoria: subs.includes(subcategoria) ? subcategoria : '',
        precio: Math.round(Number(precio) * 100) / 100, descripcion: descripcion.trim(), tallas: lista(tallas), colores: lista(colores),
        imagen: '', imagenes: [], ventaLibre: true,
      }, fotos, venta)
      guardarWa(datos.codigo, wa.trim())
      toast.success(venta ? 'Venta libre actualizada.' : 'Venta libre creada.')
      onSaved(datos, wa.trim())
    } catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo guardar.') } finally { setSaving(false) }
  }

  return <Modal open={open} onClose={onClose} title={venta ? `Editar ${venta.codigo}` : 'Nueva venta libre'} description="Solo por link: no sale en la tienda, la búsqueda ni “Nuevo”. El cliente lo encarga igual que en la web.">
    <form onSubmit={(e) => void submit(e)} className="form-grid">
      <div className="form-field sm:col-span-2"><span>Fotos (la primera es la principal)</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {fotos.map((f, i) => <div key={f.url} className="relative h-20 w-20 overflow-hidden rounded-xl border border-line bg-white">
            <img src={f.url} alt="" className="h-full w-full object-cover" />
            {i === 0 ? <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-accent"><Star size={10} className="inline" /> Principal</span>
              : <button type="button" className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] text-white" onClick={() => setFotos((x) => [x[i], ...x.filter((_, j) => j !== i)])}>Principal</button>}
            <button type="button" className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white" onClick={() => setFotos((x) => x.filter((_, j) => j !== i))} aria-label="Quitar foto"><X size={12} /></button>
          </div>)}
          <button type="button" className="grid h-20 w-20 place-items-center rounded-xl border border-dashed border-line text-muted hover:text-white" onClick={() => fileRef.current?.click()}><span className="grid place-items-center text-[11px]"><ImagePlus size={18} /> Agregar</span></button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { agregarFotos(e.target.files); e.target.value = '' }} />
        </div>
      </div>
      <label className="form-field sm:col-span-2"><span>Nombre del producto</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Tenis de caña alta negros" /></label>
      <label className="form-field"><span>Precio (US$)</span><input type="number" inputMode="decimal" min="0" step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="0.00" /></label>
      <label className="form-field"><span>Código</span><input className="font-mono uppercase" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="LIB001" /></label>
      <label className="form-field"><span>Categoría</span><select value={categoria} onChange={(e) => { setCategoria(e.target.value); setSubcategoria((SUBCATEGORIAS[e.target.value] ?? [])[0] ?? '') }}>{CATEGORIAS.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="form-field"><span>Subcategoría</span><select value={subcategoria} onChange={(e) => setSubcategoria(e.target.value)} disabled={!subs.length}>{subs.length ? subs.map((s) => <option key={s}>{s}</option>) : <option value="">—</option>}</select></label>
      <label className="form-field"><span>Marca (opcional)</span><input value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ej: Nike" /></label>
      <label className="form-field"><span>Colores (opcional)</span><input value={colores} onChange={(e) => setColores(e.target.value)} placeholder="Ej: Negro, Blanco" /></label>
      <label className="form-field sm:col-span-2"><span>Tallas (separadas por coma)</span><input value={tallas} onChange={(e) => setTallas(e.target.value)} placeholder="Ej: 40, 41, 42" />
        <div className="mt-2 flex flex-wrap gap-1.5">{TALLAS_RAPIDAS.map(([t, v]) => <button key={t} type="button" className="subtle-button px-2.5 py-1 text-[11px]" onClick={() => setTallas(v)}>{t}</button>)}</div>
      </label>
      <label className="form-field sm:col-span-2"><span>Descripción (opcional)</span><textarea rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Material, detalles, lo que el cliente debe saber" /></label>
      <label className="form-field sm:col-span-2"><span>WhatsApp del cliente (opcional)</span><input inputMode="tel" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="Ej: 8890 1122 — para mandarle el link directo" /></label>
      <div className="col-span-full flex justify-end gap-2 pt-1"><button type="button" className="subtle-button px-4" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving ? 'Guardando…' : venta ? 'Guardar cambios' : 'Crear y sacar link'}</button></div>
    </form>
  </Modal>
}
