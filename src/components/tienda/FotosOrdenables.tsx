import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Crop, Star, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FotoTienda } from '../../services/productosTienda.service'
import { resolverImagenCatalogo } from '../../utils/catalogoImagen'

// FOTOS DEL PRODUCTO, ordenables arrastrando (con el mouse o con el dedo en el teléfono: mantener
// apretada la foto un momento y moverla). La primera es la principal (portada). Cada foto tiene
// "Hacer principal", Encuadrar y Quitar.
export function FotosOrdenables({ fotos, onOrden, onQuitar, onEncuadrar, extra }: {
  fotos: FotoTienda[]
  onOrden: (nuevas: FotoTienda[]) => void
  onQuitar: (i: number) => void
  onEncuadrar: (i: number) => void
  extra?: ReactNode
}) {
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const alSoltar = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const de = fotos.findIndex((f) => f.url === active.id), a = fotos.findIndex((f) => f.url === over.id)
    if (de >= 0 && a >= 0) onOrden(arrayMove(fotos, de, a))
  }
  return <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alSoltar}>
    <SortableContext items={fotos.map((f) => f.url)} strategy={rectSortingStrategy}>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {fotos.map((ft, i) => <Foto key={ft.url} foto={ft} principal={i === 0}
          onPrincipal={() => onOrden(arrayMove(fotos, i, 0))} onQuitar={() => onQuitar(i)} onEncuadrar={() => onEncuadrar(i)} />)}
        {extra}
      </div>
    </SortableContext>
  </DndContext>
}

function Foto({ foto, principal, onPrincipal, onQuitar, onEncuadrar }: { foto: FotoTienda; principal: boolean; onPrincipal: () => void; onQuitar: () => void; onEncuadrar: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: foto.url })
  const estilo = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, touchAction: 'manipulation' as const }
  // Los botones no inician el arrastre.
  const boton = (e: React.PointerEvent | React.TouchEvent | React.MouseEvent) => e.stopPropagation()
  return <div ref={setNodeRef} style={estilo} {...attributes} {...listeners}
    className={`group relative cursor-grab select-none overflow-hidden rounded-xl border bg-white/[0.02] active:cursor-grabbing ${principal ? 'col-span-2 row-span-2 border-accent/60' : 'border-line'} ${isDragging ? 'opacity-80 shadow-2xl ring-2 ring-accent' : ''}`}>
    <img src={resolverImagenCatalogo(foto.url)} alt="" draggable={false} className="pointer-events-none aspect-square w-full object-cover" />
    <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-wrap gap-1">
      {principal && <span className="inline-flex items-center gap-1 rounded-md bg-[#1a1a1a] px-1.5 py-0.5 text-[10px] font-semibold text-[#fff]"><Star size={10} fill="currentColor" /> Principal</span>}
      {foto.file && <span className="rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-[#fff]">Nueva</span>}
    </div>
    <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between gap-1">
      {principal ? <span /> : <button type="button" onPointerDown={boton} onTouchStart={boton} onClick={onPrincipal} title="Hacer principal" aria-label="Hacer principal" className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#fff]/90 px-2 text-[11px] font-semibold text-[#1a1a1a]"><Star size={13} /></button>}
      <span className="flex gap-1">
        <button type="button" onPointerDown={boton} onTouchStart={boton} onClick={onEncuadrar} title="Encuadrar / centrar" aria-label="Encuadrar foto" className="grid size-8 place-items-center rounded-lg bg-[#fff]/90 text-[#1a1a1a]"><Crop size={14} /></button>
        <button type="button" onPointerDown={boton} onTouchStart={boton} onClick={onQuitar} title="Quitar foto" aria-label="Quitar foto" className="grid size-8 place-items-center rounded-lg bg-[#fff]/90 text-[#b42318]"><Trash2 size={15} /></button>
      </span>
    </div>
  </div>
}
