// ENVÍO A DEPARTAMENTOS. Tarifas de Cargotrans por ruta (paquetes de 0.01 a 5 kg; los de HAUSLINE
// pesan ~0.1 kg) + C$100 del motorizado que lleva el paquete a Cargotrans (en CADA envío).
// Por bus: C$160 fijo. El municipio del cliente (ciudad) decide la ruta; si no está en la lista se
// prueba con el departamento, y si tampoco, se elige la ruta a mano en el pedido.
// Rutas especiales (Puerto Cabezas, Bluefields): sin tarifa fija → se escribe a mano.

export type RutaCargotrans = 'primaria' | 'secundaria' | 'terciaria'
export type MetodoEnvio = 'cargotrans' | 'bus' | 'ninguno'
export type EleccionEnvio = { metodo: MetodoEnvio; ruta: RutaCargotrans | null }

export const CARGOTRANS_MOTORIZADO_NIO = 100
export const BUS_NIO = 160

export const RUTAS_CARGOTRANS: { ruta: RutaCargotrans; label: string; usd: number; lugares: string[] }[] = [
  {
    ruta: 'primaria', label: 'Ruta primaria', usd: 3, lugares: [
      // Occidente
      'Nagarote', 'La Paz Centro', 'Chinandega', 'Chichigalpa', 'León', 'Telica', 'El Viejo', 'Corinto', 'Posoltega', 'Quezalguaque',
      // Sur oriente
      'Nandaime', 'Masaya', 'Masatepe', 'Niquinohomo', 'Catarina', 'Nindirí', 'Dolores', 'Jinotepe', 'Nandasmo', 'San Juan de Oriente',
      'El Rosario', 'La Paz de Carazo', 'La Paz Carazo', 'San Jorge', 'Santa Teresa', 'San Marcos', 'Diriamba', 'Las Esquinas', 'Rivas',
      'Ochomogo', 'Belén', 'Diriá', 'La Conquista', 'Buenos Aires', 'Popoyuapa', 'Potosí', 'Granada', 'Diriomo', 'La Concepción',
      // Centro
      'Juigalpa', 'Teustepe', 'Boaco', 'Camoapa', 'Tecolostote', 'San Lorenzo', 'San Benito', 'Las Banderas', 'Santo Tomás', 'Santo Thomas', 'Acoyapa',
    ],
  },
  {
    ruta: 'secundaria', label: 'Ruta secundaria', usd: 6.5, lugares: [
      'Somotillo', 'Villanueva', 'Villa Nueva', 'El Sauce', 'Mina El Limón', 'Mapaisillo', 'San Jacinto', 'El Realejo',
      'Tola', 'Montelimar', 'San Rafael del Sur', 'Villa El Carmen', 'Masachapa', 'San Juan del Sur',
      'Cara de Mono', 'La Gateada', 'Muelles de los Bueyes', 'Muelle de los Bueyes', 'El Cacao', 'San Pedro de Lóvago', 'Nueva Guinea', 'Comalapa',
      'El Rama', 'Colonia Rama', 'Muy Muy', 'Matiguás',
    ],
  },
  {
    ruta: 'terciaria', label: 'Ruta terciaria', usd: 7.5, lugares: [
      'Poneloya', 'Momotombo', 'Zarzales', 'El Guasaule', 'Tonalá', 'Puerto Sandino', 'El Jicaral', 'Jicaral', 'Santa Rosa del Peñón', 'Achuapa',
      'Las Peñitas', 'La Reynaga', '15 de Julio', 'Ranchería', 'Puerto Morazán', 'Santo Tomás del Norte', 'San Francisco del Norte', 'Cinco Pinos',
      'Moyogalpa', 'Altagracia', 'La Virgen', 'La Boquita', 'Malacatoya', 'Las Salinas', 'Rancho Santa Ana', 'Peñas Blancas', 'Cárdenas',
      'San José de los Remates', 'El Tule', 'Puerto Príncipe', 'San Miguelito', 'Los Chiles', 'Talolinga', 'Boca de Sábalos', 'El Almendro', 'San Carlos',
    ],
  },
]

const norm = (v: string | null | undefined) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

function buscarRuta(valor: string | null | undefined) {
  const v = norm(valor)
  if (!v) return null
  // Exacto primero ("San Jorge"), después el lugar dentro del texto ("Chichigalpa, Chinandega").
  // Los más largos primero para que "Santo Tomás del Norte" no se confunda con "Santo Tomás".
  const todos = RUTAS_CARGOTRANS.flatMap((r) => r.lugares.map((l) => ({ r, l: norm(l) }))).sort((a, b) => b.l.length - a.l.length)
  return (todos.find((x) => x.l === v) ?? todos.find((x) => ` ${v} `.includes(` ${x.l} `)))?.r.ruta ?? null
}

// Ruta según el municipio (ciudad) del cliente; si no se encuentra, según el departamento.
export function rutaCargotrans(ciudad: string | null | undefined, departamento: string | null | undefined) {
  return buscarRuta(ciudad) ?? buscarRuta(departamento)
}

const r2 = (n: number) => Math.round(n * 100) / 100

// Costo del envío en dólares (lo que se suma al pedido) y el detalle para la línea del pedido.
export function costoEnvioDepartamento(metodo: MetodoEnvio, ruta: RutaCargotrans | null, lugar: string, tipoCambio: number) {
  const tc = tipoCambio > 0 ? tipoCambio : 37
  if (metodo === 'bus') return { usd: r2(BUS_NIO / tc), detalle: `Bus a ${lugar} (C$${BUS_NIO})` }
  if (metodo !== 'cargotrans' || !ruta) return null
  const r = RUTAS_CARGOTRANS.find((x) => x.ruta === ruta)!
  return { usd: r2(r.usd + CARGOTRANS_MOTORIZADO_NIO / tc), detalle: `Cargotrans a ${lugar} (${r.label.toLowerCase()} US$${r.usd} + C$${CARGOTRANS_MOTORIZADO_NIO} motorizado)` }
}

// Lo que se propone para un cliente de departamento: Cargotrans con la ruta de su municipio.
export const envioSugerido = (ciudad?: string | null, departamento?: string | null): EleccionEnvio => ({ metodo: 'cargotrans', ruta: rutaCargotrans(ciudad, departamento) })
