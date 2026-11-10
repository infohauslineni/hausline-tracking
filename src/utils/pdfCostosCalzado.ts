// PDF (para guardar antes del cambio de calzado) con cada zapato que ya tiene costo: foto,
// código, nombre, marca, costo, precio de venta y ganancia. Se abre en una pestaña nueva lista
// para imprimir; ahí se elige "Guardar como PDF" (en el teléfono: Compartir → Imprimir → PDF).
export type FilaCostoCalzado = { codigo: string; nombre: string; marca: string; imagen: string; costo: number; venta: number; fuente: 'ficha' | 'pedido' | 'compra libre' }

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const usd = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export function abrirPdfCostosCalzado(filas: FilaCostoCalzado[]) {
  const ventana = window.open('', '_blank')
  if (!ventana) return false
  const fecha = new Intl.DateTimeFormat('es-NI', { dateStyle: 'long' }).format(new Date())
  const ordenadas = [...filas].sort((a, b) => a.marca.localeCompare(b.marca) || a.codigo.localeCompare(b.codigo))
  const totalCosto = ordenadas.reduce((s, f) => s + f.costo, 0)
  const filasHtml = ordenadas.map((f) => {
    const gana = f.venta > 0 ? f.venta - f.costo : null
    return `<tr>
      <td class="foto">${f.imagen ? `<img src="${esc(f.imagen)}" alt="">` : ''}</td>
      <td><b>${esc(f.codigo)}</b><br><span class="nombre">${esc(f.nombre)}</span><br><span class="marca">${esc(f.marca)}</span></td>
      <td class="num">${usd(f.costo)}${f.fuente === 'pedido' ? '<br><span class="nota">de su último pedido</span>' : f.fuente === 'compra libre' ? '<br><span class="nota">de su última compra libre</span>' : ''}</td>
      <td class="num">${f.venta > 0 ? usd(f.venta) : 'Cotizar'}</td>
      <td class="num">${gana === null ? '—' : `${usd(gana)}<br><span class="nota">${Math.round((gana / f.venta) * 100)} %</span>`}</td>
    </tr>`
  }).join('')
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Calzado con costo · HAUSLINE · ${esc(fecha)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#171310;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0} .sub{color:#666;margin:4px 0 16px}
  table{width:100%;border-collapse:collapse} th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;border-bottom:2px solid #171310;padding:6px}
  td{border-bottom:1px solid #ddd;padding:6px;vertical-align:middle} tr{page-break-inside:avoid}
  td.foto{width:78px} td.foto img{width:70px;height:70px;object-fit:cover;border-radius:6px;border:1px solid #ddd;background:#f3f3f3}
  .num{text-align:right;white-space:nowrap} .nombre{font-size:12px} .marca,.nota{color:#777;font-size:10.5px}
  .barra{position:sticky;top:0;background:#fff;padding:10px 0;margin-bottom:8px;display:flex;gap:8px}
  .barra button{font-size:14px;padding:10px 16px;border-radius:8px;border:0;background:#171310;color:#fff;cursor:pointer}
  @media print{.barra{display:none} body{margin:10mm}}
</style></head><body>
<div class="barra"><button onclick="window.print()">Guardar como PDF / Imprimir</button></div>
<h1>Calzado con costo · HAUSLINE</h1>
<p class="sub">${esc(fecha)} · ${ordenadas.length} productos · costo total ${usd(totalCosto)}</p>
<table><thead><tr><th></th><th>Producto</th><th class="num">Costo</th><th class="num">Precio de venta</th><th class="num">Ganancia</th></tr></thead>
<tbody>${filasHtml}</tbody></table>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},600)})</script>
</body></html>`)
  ventana.document.close()
  return true
}
