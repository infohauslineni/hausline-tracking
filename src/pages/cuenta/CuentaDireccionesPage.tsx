import { ChevronRight, Info, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CuentaShell, Hoja } from '../../components/cuenta/CuentaShell'
import { MapaTiles } from '../../components/cuenta/MapaTiles'
import { costoDelivery, eliminarDireccion, formatoMonto, hacerPredeterminada, lineasDireccion, listarDirecciones, listarTarifas, type Direccion, type Tarifa } from '../../services/cuentaCliente.service'

export function CuentaDireccionesPage() {
  const [direcciones, setDirecciones] = useState<Direccion[] | null>(null)
  const [tarifas, setTarifas] = useState<Tarifa[]>([])
  const [borrar, setBorrar] = useState<Direccion | null>(null)
  const [trabajando, setTrabajando] = useState(false)

  const cargar = useCallback(async () => {
    const [dirs, tar] = await Promise.all([listarDirecciones().catch(() => { toast.error('No pudimos cargar tus direcciones.'); return [] as Direccion[] }), listarTarifas().catch(() => [] as Tarifa[])])
    setDirecciones(dirs); setTarifas(tar)
  }, [])
  useEffect(() => { void Promise.resolve().then(cargar) }, [cargar])

  const confirmarBorrado = async () => {
    if (!borrar) return
    setTrabajando(true)
    try { await eliminarDireccion(borrar.id); toast.success('Dirección eliminada.'); setBorrar(null); await cargar() }
    catch { toast.error('No se pudo eliminar la dirección.') } finally { setTrabajando(false) }
  }
  const predeterminar = async (d: Direccion) => {
    try { await hacerPredeterminada(d.id); toast.success(`“${d.nombre}” es tu dirección predeterminada.`); await cargar() }
    catch { toast.error('No se pudo actualizar.') }
  }

  return <CuentaShell titulo="Direcciones" subtitulo="Gestioná tus direcciones de envío y facturación." volver="/cuenta" accion={<Link to="/cuenta/direcciones/nueva" className="hsc-iconbtn -mr-2" aria-label="Agregar dirección"><Plus size={22} strokeWidth={1.7} /></Link>}>
    <div className="mt-4 space-y-3">
      {direcciones === null
        ? [0, 1].map((i) => <div key={i} className="hsp-card h-52 animate-pulse" />)
        : direcciones.length === 0
          ? <div className="hsp-card p-8 text-center">
              <MapPin size={26} strokeWidth={1.4} className="hsp-faint mx-auto" />
              <p className="mt-3 text-[14px] font-semibold">Todavía no guardaste direcciones</p>
              <p className="hsp-muted mx-auto mt-1 max-w-xs text-[12px] leading-5">Guardá tu casa, trabajo u otro lugar para pedir el envío de tus pedidos con un toque.</p>
            </div>
          : direcciones.map((d, i) => {
              const costo = costoDelivery(d, tarifas)
              return <article key={d.id} className="hsp-card hsp-rise overflow-hidden" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="p-4">
                  <div className="flex items-center gap-2">
                    <MapPin size={17} style={{ color: 'var(--ink)' }} />
                    <span className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{d.predeterminada ? 'Dirección principal' : d.tipo === 'trabajo' ? 'Trabajo' : 'Otra dirección'}</span>
                    {d.predeterminada && <span className="hsc-pill">Predeterminada</span>}
                  </div>
                  <Link to={`/cuenta/direcciones/${d.id}`} className="mt-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <strong className="block text-[14px]">{d.nombre}</strong>
                      {lineasDireccion(d).map((l) => <span key={l} className="hsp-muted block text-[12px] leading-[1.5]">{l}</span>)}
                    </span>
                    <ChevronRight size={17} className="hsp-faint shrink-0" />
                  </Link>
                </div>
                <div className="px-4"><MapaTiles lat={d.lat} lng={d.lng} alto={120} /></div>
                <div className="hsc-kv mx-4 mt-3 border-t-0 pt-0">
                  <span className="inline-flex items-center gap-1.5">Costo de envío estimado <span title="Tarifa de delivery configurada por HAUSLINE. Si dice “a cotizar”, te lo confirmamos por WhatsApp."><Info size={13} className="hsp-faint" /></span></span>
                  <strong>{costo != null ? formatoMonto(costo) : 'A cotizar'}</strong>
                </div>
                <div className="grid grid-cols-2 gap-2.5 p-4 pt-3">
                  <Link to={`/cuenta/direcciones/${d.id}`} className="hsp-btn hsp-btn--line h-10 min-h-0 text-[13px]"><Pencil size={14} /> Editar</Link>
                  <button type="button" onClick={() => setBorrar(d)} className="hsp-btn hsp-btn--line h-10 min-h-0 text-[13px]"><Trash2 size={14} /> Eliminar</button>
                </div>
                {!d.predeterminada && <button type="button" onClick={() => void predeterminar(d)} className="hsc-link -mt-1 mb-3 block w-full text-center">Establecer como predeterminada</button>}
              </article>
            })}
    </div>

    <Link to="/cuenta/direcciones/nueva" className="hsp-btn mt-5 w-full">Agregar nueva dirección</Link>

    <Hoja abierta={borrar !== null} onCerrar={() => setBorrar(null)} titulo="¿Eliminar esta dirección?">
      {borrar && <>
        <p className="hsp-muted text-[13px] leading-5"><b style={{ color: 'var(--ink)' }}>{borrar.nombre}</b> · {borrar.direccion}, {borrar.ciudad}</p>
        {borrar.predeterminada && <p className="hsp-muted mt-2 text-[12px]">Es tu dirección predeterminada: otra pasará a serlo.</p>}
        <button type="button" disabled={trabajando} onClick={() => void confirmarBorrado()} className="hsp-btn mt-5 w-full" style={{ background: '#b91c1c', borderColor: '#b91c1c' }}>{trabajando ? 'Eliminando…' : 'Eliminar dirección'}</button>
        <button type="button" onClick={() => setBorrar(null)} className="hsp-btn--ghost mt-1 w-full">Cancelar</button>
      </>}
    </Hoja>
  </CuentaShell>
}
