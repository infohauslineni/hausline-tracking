import { Trash2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Cargando, CuentaShell } from '../../components/cuenta/CuentaShell'
import { MapaTiles } from '../../components/cuenta/MapaTiles'
import { DEPARTAMENTOS_NI } from '../../constants/nicaragua'
import { costoDelivery, eliminarDireccion, formatoMonto, guardarDireccion, listarDirecciones, listarTarifas, type DireccionInput, type Tarifa, type TipoDireccion } from '../../services/cuentaCliente.service'

const PAISES = ['Nicaragua', 'Costa Rica', 'Honduras', 'El Salvador', 'Guatemala', 'Panamá', 'México', 'Estados Unidos', 'Canadá', 'Colombia', 'España']
const VACIA: DireccionInput = { nombre: '', direccion: '', referencia: null, ciudad: '', departamento: null, pais: 'Nicaragua', codigo_postal: null, tipo: 'residencial', lat: null, lng: null, predeterminada: false }
const esNicaragua = (pais: string) => pais.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'nicaragua'

// Misma pantalla para "Agregar nueva dirección" (/cuenta/direcciones/nueva) y "Editar
// dirección" (/cuenta/direcciones/:id). ?volver= regresa al pedido desde el que se abrió.
export function CuentaDireccionFormPage() {
  const { id } = useParams()
  const editando = Boolean(id && id !== 'nueva')
  const [params] = useSearchParams()
  const volver = (() => { const v = params.get('volver') ?? ''; return v.startsWith('/cuenta/') ? v : '/cuenta/direcciones' })()
  const navigate = useNavigate()
  const [form, setForm] = useState<DireccionInput | null>(editando ? null : VACIA)
  const [tarifas, setTarifas] = useState<Tarifa[]>([])
  const [guardando, setGuardando] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})

  useEffect(() => {
    void listarTarifas().then(setTarifas).catch(() => undefined)
    if (!editando) return
    void listarDirecciones().then((dirs) => {
      const d = dirs.find((x) => x.id === id)
      if (!d) { toast.error('No encontramos esa dirección.'); navigate('/cuenta/direcciones', { replace: true }); return }
      setForm({ nombre: d.nombre, direccion: d.direccion, referencia: d.referencia, ciudad: d.ciudad, departamento: d.departamento, pais: d.pais, codigo_postal: d.codigo_postal, tipo: d.tipo, lat: d.lat, lng: d.lng, predeterminada: d.predeterminada })
    })
  }, [editando, id, navigate])

  if (!form) return <CuentaShell titulo="Editar dirección" volver={volver}><Cargando /></CuentaShell>
  const set = <K extends keyof DireccionInput>(k: K, v: DireccionInput[K]) => { setForm((f) => f && { ...f, [k]: v }); setErrores((e) => ({ ...e, [k]: '' })) }
  const nica = esNicaragua(form.pais)
  const costo = costoDelivery({ ...form, costo_delivery: null }, tarifas)

  const guardar = async (event: FormEvent) => {
    event.preventDefault()
    const e: Record<string, string> = {}
    if (!form.nombre.trim()) e.nombre = 'Poné un nombre (ej. Casa, Trabajo).'
    if (form.direccion.trim().length < 3) e.direccion = 'Escribí la dirección completa.'
    if (!form.ciudad.trim()) e.ciudad = 'Escribí la ciudad.'
    if (nica && !form.departamento) e.departamento = 'Elegí el departamento.'
    if (!form.pais.trim()) e.pais = 'Escribí el país.'
    setErrores(e)
    if (Object.keys(e).length) { toast.error('Revisá los campos marcados.'); return }
    setGuardando(true)
    try {
      await guardarDireccion({ ...form, departamento: nica ? form.departamento : null }, editando ? id : undefined)
      toast.success(editando ? 'Dirección actualizada.' : 'Dirección guardada.')
      navigate(volver, { replace: true })
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar la dirección.') }
    finally { setGuardando(false) }
  }
  const borrar = async () => {
    if (!id || !window.confirm('¿Eliminar esta dirección?')) return
    try { await eliminarDireccion(id); toast.success('Dirección eliminada.'); navigate('/cuenta/direcciones', { replace: true }) }
    catch { toast.error('No se pudo eliminar.') }
  }

  return <CuentaShell titulo={editando ? 'Editar dirección' : 'Agregar nueva dirección'} volver={volver} sinNav>
    <form onSubmit={(e) => void guardar(e)} className="hsp-rise mt-2" noValidate>
      {editando && <h2 className="mb-3 text-[15px] font-semibold">Datos de la dirección</h2>}
      <Campo etiqueta="Nombre de la dirección" error={errores.nombre}>
        <input value={form.nombre} onChange={(e) => set('nombre', e.target.value.slice(0, 60))} placeholder="Ej. Casa, Trabajo, etc." />
      </Campo>
      <div className="-mt-1.5 mb-3 flex gap-2">{['Casa', 'Trabajo', 'Otro'].map((n) => <button key={n} type="button" onClick={() => { set('nombre', n === 'Otro' ? '' : n); set('tipo', n === 'Trabajo' ? 'trabajo' : n === 'Casa' ? 'residencial' : 'otro') }} className={`hsc-chip${form.nombre === n ? ' is-on' : ''}`}>{n}</button>)}</div>

      <Campo etiqueta="Dirección completa" error={errores.direccion}>
        <textarea rows={2} value={form.direccion} onChange={(e) => set('direccion', e.target.value.slice(0, 300))} placeholder="Calle, número, residencial o barrio" />
      </Campo>
      <Campo etiqueta="Referencia (opcional)">
        <input value={form.referencia ?? ''} onChange={(e) => set('referencia', e.target.value.slice(0, 300) || null)} placeholder="Ej. portón negro, frente al parque" />
      </Campo>

      <Campo etiqueta="País" error={errores.pais}>
        <input list="hsc-paises" value={form.pais} onChange={(e) => set('pais', e.target.value.slice(0, 80))} />
        <datalist id="hsc-paises">{PAISES.map((p) => <option key={p} value={p} />)}</datalist>
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        {nica && <Campo etiqueta="Departamento" error={errores.departamento}>
          <select value={form.departamento ?? ''} onChange={(e) => { set('departamento', e.target.value || null); if (!form.ciudad) set('ciudad', e.target.value.replace(/ \(.*\)$/, '')) }}>
            <option value="">Elegí…</option>
            {DEPARTAMENTOS_NI.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Campo>}
        <Campo etiqueta={nica ? 'Ciudad / municipio' : 'Ciudad'} error={errores.ciudad} className={nica ? '' : 'col-span-2'}>
          <input value={form.ciudad} onChange={(e) => set('ciudad', e.target.value.slice(0, 100))} placeholder="Managua" />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Código postal">
          <input value={form.codigo_postal ?? ''} inputMode="numeric" onChange={(e) => set('codigo_postal', e.target.value.slice(0, 20) || null)} placeholder="10000" />
        </Campo>
        <Campo etiqueta="Tipo de dirección">
          <select value={form.tipo} onChange={(e) => set('tipo', e.target.value as TipoDireccion)}>
            <option value="residencial">Residencial</option>
            <option value="trabajo">Trabajo</option>
            <option value="otro">Otro</option>
          </select>
        </Campo>
      </div>

      <p className="hsc-label mt-1">Ubicación en el mapa</p>
      <MapaTiles lat={form.lat} lng={form.lng} alto={190} zoom={form.lat != null ? 16 : 13} interactivo onChange={({ lat, lng }) => { set('lat', lat); set('lng', lng) }} />
      {form.lat != null && <button type="button" onClick={() => { set('lat', null); set('lng', null) }} className="hsc-link mt-1">Quitar ubicación</button>}

      <div className="hsc-kv mt-4">
        <span>Costo de delivery para esta zona</span>
        <strong>{costo != null ? formatoMonto(costo) : 'A cotizar por WhatsApp'}</strong>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-3 text-[13px]" style={{ color: 'var(--ink)' }}>
        <input type="checkbox" checked={form.predeterminada} onChange={(e) => set('predeterminada', e.target.checked)} className="hsc-check" />
        Establecer como dirección predeterminada
      </label>

      <button disabled={guardando} className="hsp-btn mt-6 w-full">{guardando ? 'Guardando…' : 'Guardar dirección'}</button>
      {editando && <button type="button" onClick={() => void borrar()} className="hsp-btn--ghost mt-2 inline-flex w-full items-center justify-center gap-1.5" style={{ color: '#b91c1c' }}><Trash2 size={14} /> Eliminar dirección</button>}
    </form>
  </CuentaShell>
}

function Campo({ etiqueta, error, className = '', children }: { etiqueta: string; error?: string; className?: string; children: ReactNode }) {
  return <label className={`hsc-field mb-3 block ${error ? 'has-error' : ''} ${className}`}>
    <span>{etiqueta}</span>
    {children}
    {error && <em>{error}</em>}
  </label>
}
