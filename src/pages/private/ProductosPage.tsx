import { ImagePlus, PackagePlus, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Modal } from '../../components/ui/Modal'
import { subirImagenCatalogo } from '../../services/catalogoImagenes.service'
import { actualizarImagenProducto, autoSincronizarCatalogo, eliminarProducto, guardarProducto, listarProductos, listarProveedores, sincronizarCatalogo } from '../../services/comercial.service'
import type { Producto, Proveedor } from '../../types/domain'

const empty = { codigo:'', nombre:'', marca:'', categoria:'', proveedor_id:'', tallas:'', precio_compra:'', precio_venta:'', descripcion:'' }
const money = (n:number)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0)
const gananciaProducto = (p:Producto)=>Number(p.precio_venta||0)-Number(p.precio_compra||0)
const margenProducto = (p:Producto)=>Number(p.precio_venta||0)>0?(gananciaProducto(p)/Number(p.precio_venta))*100:-1
type OrdenProducto = 'codigo'|'ganancia'|'margen'
export function ProductosPage(){
  const [items,setItems]=useState<Producto[]>([]),[providers,setProviders]=useState<Proveedor[]>([]),[search,setSearch]=useState(''),[open,setOpen]=useState(false),[editing,setEditing]=useState<Producto|null>(null)
  const [orden,setOrden]=useState<OrdenProducto>('codigo')
  const load=()=>void Promise.all([listarProductos(),listarProveedores()]).then(([p,v])=>{setItems(p);setProviders(v)}).catch(()=>toast.error('No se pudieron cargar los productos.'))
  // Al abrir la página: carga lo que hay y, en segundo plano, sincroniza el catálogo web
  // (máx. 1 vez cada 15 min). Si sincronizó, recarga para mostrar precios/fotos frescos.
  useEffect(()=>{load();void autoSincronizarCatalogo().then(did=>{if(did)load()})},[])
  const filtered=useMemo(()=>{
    const arr=items.filter(p=>[p.codigo,p.nombre,p.marca].some(v=>v?.toLowerCase().includes(search.toLowerCase())))
    if(orden==='ganancia') arr.sort((a,b)=>gananciaProducto(b)-gananciaProducto(a))
    else if(orden==='margen') arr.sort((a,b)=>margenProducto(b)-margenProducto(a))
    else arr.sort((a,b)=>(a.codigo||'').localeCompare(b.codigo||''))
    return arr
  },[items,search,orden])
  const remove=async(item:Producto)=>{if(!confirm(`¿Desactivar ${item.nombre}?`))return;try{await eliminarProducto(item.id);setItems(all=>all.filter(p=>p.id!==item.id));toast.success('Producto desactivado.')}catch{toast.error('No se pudo desactivar.')}}
  const sync=async()=>{try{const total=await sincronizarCatalogo();toast.success(`${total} productos sincronizados desde hauslineshopni.es.`);load()}catch(error){toast.error(error instanceof Error?error.message:'No se pudo sincronizar el catálogo.')}}
  return <div><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="eyebrow">Catálogo</p><h1 className="page-title">Productos</h1><p className="page-subtitle">La foto guardada aquí aparecerá automáticamente en el tracking del cliente.</p></div><div className="flex flex-wrap gap-2"><button className="subtle-button px-4" onClick={()=>void sync()}>Sincronizar catálogo</button><button className="primary-button px-5" onClick={()=>{setEditing(null);setOpen(true)}}><Plus size={17}/> Nuevo producto</button></div></div>
    <div className="mt-6 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18}/><input className="search-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Código, producto o marca"/></div><select className="select-input sm:w-56" value={orden} onChange={e=>setOrden(e.target.value as OrdenProducto)} aria-label="Ordenar"><option value="codigo">Ordenar: Código</option><option value="ganancia">Mayor ganancia</option><option value="margen">Mayor margen</option></select></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(p=><article className="panel-card" key={p.id}><div className="flex items-start justify-between"><span className="grid size-16 place-items-center overflow-hidden rounded-xl bg-accent/10 text-accent">{p.imagen?<img src={p.imagen} alt={p.nombre} className="size-full object-cover"/>:<PackagePlus size={22}/>}</span><div className="flex gap-1"><button className="table-action" onClick={()=>{setEditing(p);setOpen(true)}}><Pencil size={15}/></button><button className="table-action hover:text-red-300" onClick={()=>void remove(p)}><Trash2 size={15}/></button></div></div><p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-accent">{p.codigo}</p><strong className="mt-1 block">{p.nombre}</strong><p className="mt-1 text-xs text-muted">{[p.marca,p.categoria,p.proveedores?.nombre].filter(Boolean).join(' · ')}</p><Rentabilidad compra={Number(p.precio_compra)} venta={Number(p.precio_venta)}/></article>)}</div>
    <ProductModal open={open} item={editing} providers={providers} onClose={()=>setOpen(false)} onSaved={saved=>{setItems(all=>editing?all.map(p=>p.id===saved.id?saved:p):[saved,...all]);setOpen(false)}}/>
  </div>
}
function ProductModal({open,item,providers,onClose,onSaved}:{open:boolean;item:Producto|null;providers:Proveedor[];onClose:()=>void;onSaved:(p:Producto)=>void}){
  const [form,setForm]=useState(empty),[file,setFile]=useState<File|null>(null),[saving,setSaving]=useState(false)
  useEffect(()=>{setForm(item?{codigo:item.codigo,nombre:item.nombre,marca:item.marca??'',categoria:item.categoria??'',proveedor_id:item.proveedor_id??'',tallas:item.tallas.join(', '),precio_compra:String(item.precio_compra),precio_venta:String(item.precio_venta),descripcion:item.descripcion??''}:empty);setFile(null)},[item,open])
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!form.codigo.trim()||!form.nombre.trim())return toast.error('Completa código y producto.');setSaving(true);try{let saved=await guardarProducto({codigo:form.codigo.trim().toUpperCase(),nombre:form.nombre.trim(),marca:form.marca||null,categoria:form.categoria||null,proveedor_id:form.proveedor_id||null,tallas:form.tallas.split(',').map(v=>v.trim()).filter(Boolean),precio_compra:Number(form.precio_compra||0),precio_venta:Number(form.precio_venta||0),imagen:item?.imagen??null,descripcion:form.descripcion||null,activo:true},item?.id);if(file){const imagen=await subirImagenCatalogo('productos',saved.id,file);saved=await actualizarImagenProducto(saved.id,imagen)}onSaved(saved);toast.success('Producto y foto guardados.')}catch(err){toast.error(err instanceof Error?err.message:'No se pudo guardar el producto.')}finally{setSaving(false)}}
  return <Modal open={open} onClose={onClose} title={item?'Editar producto':'Nuevo producto'}><form onSubmit={e=>void submit(e)} className="form-grid"><Field label="Código"><input value={form.codigo} onChange={e=>setForm({...form,codigo:e.target.value})}/></Field><Field label="Producto"><input value={form.nombre} onChange={e=>setForm({...form,nombre:e.target.value})}/></Field><Field label="Marca"><input value={form.marca} onChange={e=>setForm({...form,marca:e.target.value})}/></Field><Field label="Categoría"><input value={form.categoria} onChange={e=>setForm({...form,categoria:e.target.value})}/></Field><Field label="Proveedor"><select value={form.proveedor_id} onChange={e=>setForm({...form,proveedor_id:e.target.value})}><option value="">Sin proveedor</option>{providers.map(p=><option value={p.id} key={p.id}>{p.nombre}</option>)}</select></Field><Field label="Tallas (separadas por coma)"><input value={form.tallas} onChange={e=>setForm({...form,tallas:e.target.value})}/></Field><Field label="Precio de compra"><input type="number" min="0" step=".01" value={form.precio_compra} onChange={e=>setForm({...form,precio_compra:e.target.value})}/></Field><Field label="Precio de venta"><input type="number" min="0" step=".01" value={form.precio_venta} onChange={e=>setForm({...form,precio_venta:e.target.value})}/></Field><label className="form-field col-span-full"><span>Foto de referencia</span><span className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 text-sm text-muted"><ImagePlus size={20} className="text-accent"/>{file?file.name:item?.imagen?'Cambiar foto actual':'Seleccionar JPG, PNG o WEBP'}<input className="hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]??null)}/></span></label><label className="form-field col-span-full"><span>Descripción</span><textarea rows={3} value={form.descripcion} onChange={e=>setForm({...form,descripcion:e.target.value})}/></label><div className="col-span-full flex justify-end gap-2"><button type="button" className="subtle-button" onClick={onClose}>Cancelar</button><button className="primary-button px-5" disabled={saving}>{saving?'Guardando…':'Guardar'}</button></div></form></Modal>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="form-field"><span>{label}</span>{children}</label>}
function Money({label,value,accent}:{label:string;value:number;accent?:boolean}){return <div><span className="text-[10px] uppercase text-muted">{label}</span><strong className={`mt-1 block tabular-nums ${accent?'text-accent':''}`}>${money(value)}</strong></div>}
// Rentabilidad del producto: costo, venta, ganancia, margen % y su indicador
// (🟢 alto ≥35% · 🟡 medio 20-35% · 🔴 bajo <20%). Sin precio de compra: "Pendiente".
function Rentabilidad({compra,venta}:{compra:number;venta:number}){
  const sinCosto=!(compra>0)
  const ganancia=venta-compra
  const margen=venta>0?(ganancia/venta)*100:0
  const nivel=margen>=35?{label:'🟢 Margen alto',cls:'text-emerald-300'}:margen>=20?{label:'🟡 Margen medio',cls:'text-amber-300'}:{label:'🔴 Margen bajo',cls:'text-red-300'}
  return <div className="mt-5 border-t border-line pt-4">
    <div className="grid grid-cols-2 gap-3"><Money label="Costo total" value={compra}/><Money label="Precio venta" value={venta} accent/></div>
    {sinCosto
      ? <p className="mt-3 text-[11px] text-muted">Ganancia: <em className="not-italic font-semibold text-amber-300">Pendiente de calcular</em> · registra el precio de compra</p>
      : <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-muted">Ganancia <b className={`tabular-nums ${ganancia>=0?'text-emerald-300':'text-red-300'}`}>${money(ganancia)}</b></span><span className={`font-semibold ${nivel.cls}`}>{nivel.label} · {margen.toFixed(1)}%</span></div>}
  </div>
}
