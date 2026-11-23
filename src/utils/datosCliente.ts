import { DEPARTAMENTOS_NI } from '../constants/nicaragua'
import { RUTAS_CARGOTRANS } from '../constants/cargotrans'

// DATOS DEL CLIENTE PARA CONFIRMAR UNA ORDEN
// 1) mensajePedirDatos: el mensaje (de "usted") que se le manda por WhatsApp con los datos que
//    faltan. Viene como formulario para que el cliente lo copie y lo complete.
// 2) leerDatosCliente: cuando el cliente responde, se pega su texto y se sacan los datos
//    (aunque no respete el formato: busca el correo, el número y el departamento sueltos).

// La respuesta pegada viaja a "Nuevo pedido" por sessionStorage con esta clave.
export const CLAVE_DATOS_CLIENTE = 'hl-datos-cliente'

export type DatosClienteLeidos = { nombre?: string; whatsapp?: string; correo?: string; departamento?: string; ciudad?: string; direccion?: string; referencia?: string; talla?: string }

export function mensajePedirDatos({ nombre, incluirTalla = false }: { nombre?: string; incluirTalla?: boolean } = {}) {
  const saludo = nombre?.trim() ? `Hola ${nombre.trim().split(/\s+/)[0]}` : 'Hola'
  return [
    `${saludo}, ¡muchas gracias por su compra en HAUSLINE! Para confirmar su pedido necesitamos estos datos. Puede copiar este mensaje, completarlo y enviárnoslo:`,
    '',
    'Nombre completo:',
    'WhatsApp:',
    'Correo (para su factura y el seguimiento):',
    'Departamento:',
    'Ciudad / municipio:',
    'Dirección exacta:',
    'Punto de referencia:',
    ...(incluirTalla ? ['Talla (EUR):'] : []),
    '',
    'Apenas los recibamos le confirmamos su pedido. ¡Gracias!',
  ].join('\n')
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
// Etiqueta → campo. Se compara sin acentos, sin mayúsculas y sin lo que va entre paréntesis.
const ETIQUETAS: [keyof DatosClienteLeidos, RegExp][] = [
  ['nombre', /^(nombre( completo)?|nombre y apellidos?|name)$/],
  ['whatsapp', /^(whats ?app|wsp|telefono|tel|celular|cel|numero( de (whats ?app|telefono|celular))?|movil)$/],
  ['correo', /^(correo( electronico)?|e-?mail|mail|gmail)$/],
  ['departamento', /^(departamento|depto|dpto|depart)$/],
  ['ciudad', /^(ciudad|municipio|ciudad \/ municipio|ciudad\/municipio|ciudad o municipio)$/],
  ['direccion', /^(direccion( exacta)?|domicilio|direccion de entrega)$/],
  ['referencia', /^(punto de referencia|referencia|ref)$/],
  ['talla', /^(talla|tallas|size|numero de calzado)( \(?eur\)?)?$/],
]
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

// Devuelve el departamento tal como está en la lista (ej. "leon" → "León").
export function departamentoDe(texto: string): string | undefined {
  const t = norm(texto)
  for (const d of DEPARTAMENTOS_NI) {
    const base = norm(d.split(' (')[0])
    if (new RegExp(`(^|[^a-z])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)) return d
  }
  if (/caribe norte|bilwi|puerto cabezas/.test(t)) return 'RACCN (Costa Caribe Norte)'
  if (/caribe sur|bluefields/.test(t)) return 'RACCS (Costa Caribe Sur)'
  return undefined
}

export function leerDatosCliente(texto: string): DatosClienteLeidos {
  const datos: DatosClienteLeidos = {}
  const lineas = String(texto ?? '').split(/\r?\n/).map((l) => l.replace(/^[\s>*•\-–—]*(\d{1,2}[.)]\s*)?/, '').trim()).filter(Boolean)
  for (const l of lineas) {
    const m = l.match(/^([^:：]{2,45})[:：]\s*(.*)$/)
    if (!m) continue
    const etiqueta = norm(m[1]).replace(/\(.*?\)/g, '').replace(/[^a-z0-9 /-]/g, '').replace(/\s+/g, ' ').trim()
    const valor = m[2].trim()
    if (!valor) continue
    const campo = ETIQUETAS.find(([, re]) => re.test(etiqueta))?.[0]
    if (campo && !datos[campo]) datos[campo] = valor
  }
  // Lo que no vino con etiqueta se busca suelto en todo el texto.
  if (!datos.correo) datos.correo = String(texto).match(EMAIL)?.[0]
  if (datos.correo) datos.correo = datos.correo.match(EMAIL)?.[0] ?? datos.correo
  if (!datos.whatsapp) {
    const tel = String(texto).replace(EMAIL, ' ').match(/(\+?\s?505[\s-]?)?\b\d{4}[\s-]?\d{4}\b/)
    if (tel) datos.whatsapp = tel[0]
  }
  if (datos.whatsapp) datos.whatsapp = datos.whatsapp.replace(/[^\d+]/g, '')
  if (datos.departamento) datos.departamento = departamentoDe(datos.departamento) ?? datos.departamento
  else datos.departamento = departamentoDe(String(texto))
  // Sin etiquetas: si la primera línea parece un nombre (solo letras, 2 palabras o más), es el nombre.
  // (Se saltan los saludos: "Hola buenas", "Buenas tardes", "Gracias"…)
  const saludo = (l: string) => /^(hola|buenas|buenos|buen dia|saludos|gracias|muchas gracias|ok|listo|aqui|aca|mis datos|estos son)\b/.test(norm(l))
  const posibleNombre = lineas.slice(0, 3).find((l) => !saludo(l) && /^[\p{L}][\p{L}' .]{2,60}$/u.test(l) && l.trim().split(/\s+/).length >= 2 && !departamentoDe(l))
  if (!datos.nombre && posibleNombre) datos.nombre = posibleNombre
  leerLineasSueltas(lineas, datos)
  for (const k of Object.keys(datos) as (keyof DatosClienteLeidos)[]) if (!datos[k]) delete datos[k]
  return datos
}

// Cuántos datos se encontraron (para avisar "Encontré 6 datos").
export const cuantosDatos = (d: DatosClienteLeidos) => Object.values(d).filter(Boolean).length

// Las líneas SIN etiqueta (el cliente escribió solo los datos, uno por línea):
//   "Chinandega" (el departamento) → ya se tomó; "Chichigalpa" (línea corta) → municipio;
//   la línea con señas ("1c al este", "frente a…", "Esc. …") → dirección; la siguiente
//   ("Casa 2 pisos celeste") → punto de referencia; "Talla 38 EUR" → talla 38.
const SENAS = /(\d+(\/\d+)?\s*(c|cuadras?|cdras?|vrs?|varas?|km|mts?|metros)\b|\bal (norte|sur|este|oeste|lago)\b|\b(frente|contiguo|costado|detras|detrás|enfrente|esquina|semaforos?|rotonda|iglesia|parque|escuela|esc|colegio|gasolinera|mercado|bo|barrio|bo\.|reparto|rpto|residencial|res|colonia|col|calle|avenida|ave|casa|km|carretera|comarca|villa|urbanizacion|urbanización|edificio|apto|apartamento|porton|portón|pulperia|pulpería)\b)/i
function leerLineasSueltas(lineas: string[], datos: DatosClienteLeidos) {
  const conEtiqueta = (l: string) => { const m = l.match(/^([^:：]{2,45})[:：]/); if (!m) return false; const e = norm(m[1]).replace(/\(.*?\)/g, '').replace(/[^a-z0-9 /-]/g, '').replace(/\s+/g, ' ').trim(); return ETIQUETAS.some(([, re]) => re.test(e)) }
  const esDepto = (l: string) => { const d = departamentoDe(l); return d ? norm(l).replace(/[^a-z ]/g, '').trim() === norm(d.split(' (')[0]) : false }
  let deptoVisto = false
  const municipios = new Set(RUTAS_CARGOTRANS.flatMap((r) => r.lugares.map(norm)))
  const esMunicipio = (l: string) => municipios.has(norm(l).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim())
  for (const l of lineas) {
    if (conEtiqueta(l) || l === datos.nombre || EMAIL.test(l) || /^(hola|buenas|buenos|buen dia|saludos|gracias|muchas gracias|ok|listo)\b/.test(norm(l))) continue
    if (/^\+?[\d\s-]{8,16}$/.test(l)) continue
    const talla = l.match(/^(?:talla|tallas|size|n[uú]mero)\s*[:#]?\s*(\d{2}(?:[.,]5)?)/i) ?? l.match(/^(\d{2}(?:[.,]5)?)\s*(?:eur|eu)$/i)
    if (talla) { if (!datos.talla) datos.talla = talla[1].replace(',', '.'); continue }
    if (esDepto(l) && !deptoVisto) { deptoVisto = true; continue }
    // "Chinandega, Chichigalpa": el departamento y el municipio en la misma línea.
    const partes = l.split(/\s*[,/-]\s*/).filter(Boolean)
    if (partes.length === 2 && !SENAS.test(l) && partes.some(esDepto)) { if (!datos.ciudad) datos.ciudad = partes.find((x) => !esDepto(x)) ?? partes[1]; continue }
    const corta = /^[\p{L}][\p{L}' .]{1,40}$/u.test(l) && l.split(/\s+/).length <= 4 && !SENAS.test(l)
    // Saludos o frases sueltas ("Hola", "Quiero estos") no son datos: el municipio va después del
    // departamento (o es uno conocido) y la dirección lleva señas o va después del lugar.
    if (corta && !datos.ciudad && (deptoVisto || esMunicipio(l) || esDepto(l))) { datos.ciudad = l; continue }
    if (!datos.direccion) { if (SENAS.test(l) || deptoVisto || datos.ciudad) datos.direccion = l; continue }
    if (!datos.referencia) { datos.referencia = l; continue }
    datos.referencia = `${datos.referencia}. ${l}`
  }
}
