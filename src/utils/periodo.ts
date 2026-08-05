export type Periodo = { periodo: string; desde: string; hasta: string; etiqueta: string }

function toISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Devuelve el mes de la fecha dada (por defecto hoy): primer y último día + etiqueta. */
export function periodoDeMes(reference = new Date()): Periodo {
  const inicio = new Date(reference.getFullYear(), reference.getMonth(), 1)
  const fin = new Date(reference.getFullYear(), reference.getMonth() + 1, 0)
  return {
    periodo: toISO(inicio),
    desde: toISO(inicio),
    hasta: toISO(fin),
    etiqueta: new Intl.DateTimeFormat('es-NI', { month: 'long', year: 'numeric' }).format(inicio),
  }
}

/** Clave estable del mes actual para detectar cambios de mes en el navegador. */
export function claveMesActual() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
