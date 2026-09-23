import { Package } from 'lucide-react'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'
import { etapaBase } from '../../constants/orders'
import type { EstadoPedido } from '../../types/domain'
import { etapaCliente } from '../../services/cuentaCliente.service'

export function FotoProducto({ src, tam = 64, redondo = 12 }: { src: string | null | undefined; tam?: number; redondo?: number }) {
  const url = resolverImagenCatalogo(src)
  return <span className="hsc-thumb" style={{ width: tam, height: tam, borderRadius: redondo }}>
    {url ? <img src={url} alt="" loading="lazy" /> : <Package size={Math.round(tam / 3)} strokeWidth={1.5} />}
  </span>
}

// Punto + etiqueta. Verde SOLO para estados activos/disponibles (regla de la marca).
export function EstadoPedidoTag({ estado }: { estado: EstadoPedido }) {
  const etapa = etapaCliente(estado)
  const color = etapa === 'cancelado' ? '#b91c1c' : '#16a34a'
  const base = etapaBase(estado)
  const texto = base === 'disponible_entrega' || base === 'pagado' ? 'Disponible para entrega'
    : base === 'empaquetado' ? 'Empaquetado, listo para envío'
    : base === 'llego_nicaragua' ? 'Llegó a Nicaragua'
    : etapa === 'proceso' ? 'En proceso' : etapa === 'enviado' ? 'En tránsito' : etapa === 'entregado' ? 'Entregado' : 'Cancelado'
  return <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color }}><span className="hsc-dot" style={{ background: color }} />{texto}</span>
}

// Mini seguimiento de 3 pasos de la tarjeta "Pedidos recientes": En proceso · Enviado · Entregado.
export function MiniProgreso({ estado }: { estado: EstadoPedido }) {
  const etapa = etapaCliente(estado)
  if (etapa === 'cancelado') return null
  const idx = etapa === 'proceso' ? 0 : etapa === 'enviado' ? 1 : 2
  const pasos = ['En proceso', 'Enviado', 'Entregado']
  return <div className="hsc-mini" aria-label={`Etapa: ${pasos[idx]}`}>
    <div className="hsc-mini__rail"><span style={{ width: `${idx * 50}%` }} /></div>
    <div className="hsc-mini__steps">
      {pasos.map((p, i) => <span key={p} className={i <= idx ? 'is-on' : ''} style={{ textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center' }}><i />{p}</span>)}
    </div>
  </div>
}
