// Cuentas de pago que se muestran/envían cuando el pedido está disponible para entrega.
export type CuentaPago = { banco: string; numero: string; titular: string }

// Respaldo: solo se usa si en el panel no hay ninguna cuenta con "Visible a clientes"
// encendida (o si todavía no cargaron). Lo normal es cambiarlas con ese botón en Mi cuenta.
export const CUENTAS_PAGO: CuentaPago[] = [
  { banco: 'LAFISE (USD)', numero: '133254039', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'LAFISE (Córdobas)', numero: '138038710', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'BAC (USD)', numero: '374570968', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'BAC (Córdobas)', numero: '374570869', titular: 'Alejandro Uzziel Linares Flores' },
]

// Cuentas elegidas en el panel (las tarjetas con "Visible a clientes"). Las carga
// cargarCuentasPagoClientes() (cuentas.service) al abrir el panel y al tocar el botón;
// null = no hay ninguna encendida o aún no cargaron → se usa el respaldo.
let cuentasDelPanel: CuentaPago[] | null = null
export function fijarCuentasPago(lista: CuentaPago[] | null) { cuentasDelPanel = lista && lista.length ? lista : null }
export const cuentasPagoActuales = () => cuentasDelPanel ?? CUENTAS_PAGO

// Una cuenta por bloque, con línea en blanco entre cada una para que en WhatsApp
// no se vea todo amontonado.
export const cuentasTexto = () => cuentasPagoActuales().map((c) => `• ${c.banco}\n  ${c.numero}${c.titular ? ` — ${c.titular}` : ''}`).join('\n\n')

// Opciones de envío. Cargotrans: solo los C$100 son fijos; la tarifa depende del peso y el departamento.
export const DELIVERY_OPCIONES = [
  { nombre: 'Bus / departamento', detalle: 'Lo dejamos en el bus hacia tu departamento.', costo: 'C$160' },
  { nombre: 'Cargotrans', detalle: 'C$100 + tarifa según el peso y el departamento.', costo: 'C$100 +' },
  { nombre: 'Managua', detalle: 'Delivery a domicilio con costo adicional.', costo: 'Consultar' },
]
