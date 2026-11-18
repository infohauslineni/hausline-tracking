import { DEPARTAMENTOS_NI } from '../constants/nicaragua'

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
  if (!datos.nombre && lineas[0] && /^[\p{L}][\p{L}' .]{2,60}$/u.test(lineas[0]) && lineas[0].trim().split(/\s+/).length >= 2 && !/:/.test(lineas[0])) datos.nombre = lineas[0]
  for (const k of Object.keys(datos) as (keyof DatosClienteLeidos)[]) if (!datos[k]) delete datos[k]
  return datos
}

// Cuántos datos se encontraron (para avisar "Encontré 6 datos").
export const cuantosDatos = (d: DatosClienteLeidos) => Object.values(d).filter(Boolean).length
