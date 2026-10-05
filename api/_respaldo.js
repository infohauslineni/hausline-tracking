// RESPALDO SEMANAL en Google Drive: un Excel (.xlsx) con TODA la información del negocio
// (pedidos, productos de cada pedido, clientes, pagos, gastos, cuentas, encargos, cupones…),
// una hoja por tabla. Se guarda en  HAUSLINE Facturas / ADMINISTRACION / RESPALDOS / Respaldo HAUSLINE <fecha>.xlsx
// (todos juntos, ya no repartidos en la carpeta de cada mes con las facturas).
// Corre solo los LUNES a las 5 a. m. (Nicaragua) dentro de la tarea de 15 min, y también a mano
// desde el panel (Configuración → "Hacer respaldo ahora").
import ExcelJS from 'exceljs'
import { ESTADO_LABEL } from './_correo.js'
import { subirArchivoDrive } from './_drive.js'

const CARPETA_ADMIN = 'ADMINISTRACION'

// Tablas a respaldar (hoja → tabla). Las que no existan se saltan solas.
const TABLAS = [
  ['Pedidos', 'pedidos'], ['Productos de pedidos', 'pedido_items'], ['Costos de productos', 'pedido_item_costos'],
  ['Historial de pedidos', 'historial_pedidos'], ['Clientes', 'clientes'], ['Pagos', 'pagos'], ['Gastos', 'gastos'],
  ['Cuentas bancarias', 'cuentas_bancarias'], ['Movimientos de cuentas', 'movimientos_cuenta'], ['Transferencias', 'transferencias_cuenta'],
  ['Encargos web', 'solicitudes'], ['Reembolsos', 'solicitudes_reembolso'], ['Cupones', 'cupones'], ['Promociones', 'promociones'],
  ['Inversiones (stock)', 'inversiones'], ['Deudas', 'deudas'], ['Pagos de deudas', 'pagos_deuda'], ['Trayectos', 'trayectos'],
  ['Proveedores', 'proveedores'], ['Productos (catálogo)', 'productos'], ['Reseñas', 'resenas'],
  ['Cuentas de clientes', 'cuentas_cliente'], ['Direcciones de clientes', 'direcciones_cliente'], ['Suscriptores', 'suscriptores'],
]

async function leerTodo(db, tabla) {
  const filas = []
  for (let desde = 0; desde < 200_000; desde += 1000) {
    const { data, error } = await db.from(tabla).select('*').range(desde, desde + 999)
    if (error) return { error: error.message, filas }
    filas.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return { filas }
}

const valorCelda = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)

function hoja(libro, nombre, filas) {
  const ws = libro.addWorksheet(nombre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
  const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))]
  if (!columnas.length) { ws.addRow(['(sin datos)']); return }
  ws.columns = columnas.map((c) => ({ header: c, key: c, width: Math.min(45, Math.max(10, c.length + 2)) }))
  for (const f of filas) ws.addRow(Object.fromEntries(columnas.map((c) => [c, valorCelda(f[c])])))
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } }
}

// Hoja fácil de leer: un pedido por fila con el nombre del cliente y la etapa en palabras.
function hojaPedidosLegible(libro, pedidos, clientes) {
  const cli = new Map(clientes.map((c) => [c.id, c]))
  const filas = pedidos
    .slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((p) => ({
      'Código': p.codigo, 'Fecha': p.fecha_pedido, 'Cliente': cli.get(p.cliente_id)?.nombre ?? '', 'WhatsApp': cli.get(p.cliente_id)?.whatsapp ?? '',
      'Etapa': ESTADO_LABEL[p.estado] ?? p.estado, 'Total (US$)': Number(p.total || 0), 'Abono (US$)': Number(p.abono || 0), 'Saldo (US$)': Number(p.saldo || 0),
      'Cupón': p.cupon_codigo ?? '', 'Entrega estimada': p.fecha_estimada ?? '', 'Archivado': p.activo === false ? 'Sí' : '',
    }))
  hoja(libro, 'Pedidos (fácil de leer)', filas)
}

export async function hacerRespaldo(db) {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'HAUSLINE'
  libro.created = new Date()
  const resumen = libro.addWorksheet('Resumen')
  const datos = {}
  for (const [, tabla] of TABLAS) datos[tabla] = await leerTodo(db, tabla)

  const fecha = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10) // hoy en Nicaragua
  resumen.addRow(['Respaldo HAUSLINE']).font = { bold: true, size: 16 }
  resumen.addRow([`Generado: ${new Intl.DateTimeFormat('es-NI', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Managua' }).format(new Date())}`])
  resumen.addRow([])
  resumen.addRow(['Hoja', 'Filas']).font = { bold: true }
  hojaPedidosLegible(libro, datos.pedidos?.filas ?? [], datos.clientes?.filas ?? [])
  resumen.addRow(['Pedidos (fácil de leer)', (datos.pedidos?.filas ?? []).length])
  let total = 0
  for (const [nombre, tabla] of TABLAS) {
    const r = datos[tabla]
    if (r.error && !r.filas.length) continue // la tabla no existe en esta base
    hoja(libro, nombre, r.filas)
    resumen.addRow([nombre, r.filas.length])
    total += r.filas.length
  }
  resumen.getColumn(1).width = 34
  resumen.getColumn(2).width = 12

  const buffer = Buffer.from(await libro.xlsx.writeBuffer())
  const filename = `Respaldo HAUSLINE ${fecha}.xlsx`
  const drive = await subirArchivoDrive({ carpeta: CARPETA_ADMIN, codigo: 'RESPALDOS', fecha, filename, data: buffer, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  if (drive?.skipped) throw new Error(`Drive: ${drive.skipped}`)
  return { filename, filas: total, kb: Math.round(buffer.length / 1024), carpeta: `HAUSLINE Facturas / ${CARPETA_ADMIN} / RESPALDOS` }
}
