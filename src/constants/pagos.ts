// Cuentas de pago que se muestran/envían cuando el pedido está disponible para entrega.
export type CuentaPago = { banco: string; numero: string; titular: string }

export const CUENTAS_PAGO: CuentaPago[] = [
  { banco: 'LAFISE (USD)', numero: '133210618', titular: 'Xiomara Rivas López' },
  { banco: 'LAFISE (Córdobas)', numero: '138038710', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'BAC (USD)', numero: '374570968', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'BAC (Córdobas)', numero: '374570869', titular: 'Alejandro Uzziel Linares Flores' },
]

// Una cuenta por bloque, con línea en blanco entre cada una para que en WhatsApp
// no se vea todo amontonado.
export const cuentasTexto = () => CUENTAS_PAGO.map((c) => `• ${c.banco}\n  ${c.numero} — ${c.titular}`).join('\n\n')

// Opciones de envío. Cargotrans: solo los C$100 son fijos; la tarifa depende del peso y el departamento.
export const DELIVERY_OPCIONES = [
  { nombre: 'Bus / departamento', detalle: 'Lo dejamos en el bus hacia tu departamento.', costo: 'C$160' },
  { nombre: 'Cargotrans', detalle: 'C$100 + tarifa según el peso y el departamento.', costo: 'C$100 +' },
  { nombre: 'Managua', detalle: 'Delivery a domicilio con costo adicional según la zona.', costo: 'Consultar' },
]
