// Departamentos y regiones autónomas de Nicaragua. Se usan como opciones fijas en el
// registro del cliente para que el dato quede limpio (antes era texto libre y salía
// "MANAGUA MANAGUA", "Nicaragua managua", etc.) y así el aviso de "disponible para
// entrega" puede decidir bien el tipo de envío: Managua = delivery; el resto = bus/Cargotrans.
export const DEPARTAMENTOS_NI = [
  'Managua', 'Masaya', 'Carazo', 'Granada', 'Rivas', 'León', 'Chinandega',
  'Estelí', 'Madriz', 'Nueva Segovia', 'Matagalpa', 'Jinotega', 'Boaco',
  'Chontales', 'Río San Juan', 'RACCN (Costa Caribe Norte)', 'RACCS (Costa Caribe Sur)',
] as const

const sinAcentos = (valor: string) => valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// True si alguno de los datos de ubicación indica Managua (departamento o ciudad).
// Tolera texto sucio ("Nicaragua managua", "MANAGUA, MANAGUA") buscando la palabra.
export function esManagua(...valores: (string | null | undefined)[]) {
  return valores.some((valor) => valor && sinAcentos(valor).includes('managua'))
}

// True si tenemos algún dato de ubicación (para saber si podemos personalizar el mensaje).
export function tieneUbicacion(...valores: (string | null | undefined)[]) {
  return valores.some((valor) => Boolean(valor && valor.trim()))
}
