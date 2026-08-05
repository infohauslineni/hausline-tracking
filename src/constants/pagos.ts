// Cuentas de pago que se muestran/envían cuando el pedido está disponible para entrega.
export type CuentaPago = { banco: string; numero: string; titular: string }

export const CUENTAS_PAGO: CuentaPago[] = [
  { banco: 'LAFISE (USD)', numero: '133254039', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'LAFISE (Córdobas)', numero: '138038710', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'Billetera Móvil', numero: '8487-6610', titular: 'Alejandro Uzziel Linares Flores' },
  { banco: 'BAC (Córdobas)', numero: '360322192', titular: 'Tania Vanessa Flores Rivas' },
]

export const cuentasTexto = () => CUENTAS_PAGO.map((c) => `• ${c.banco}: ${c.numero} — ${c.titular}`).join('\n')

// Opciones de envío. Cargotrans: solo los C$100 son fijos; la tarifa depende del peso y el departamento.
export const DELIVERY_OPCIONES = [
  { nombre: 'Bus / departamento', detalle: 'Lo dejamos en el bus hacia tu departamento.', costo: 'C$160' },
  { nombre: 'Cargotrans', detalle: 'C$100 + tarifa según el peso y el departamento.', costo: 'C$100 +' },
  { nombre: 'Managua', detalle: 'Delivery a domicilio con costo adicional según la zona.', costo: 'Consultar' },
]
