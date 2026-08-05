export function limpiarTelefono(value: string) {
  return value.replace(/\D/g, '')
}

export function normalizarTelefonoNicaragua(value: string) {
  let phone = limpiarTelefono(value)
  if (phone.startsWith('00')) phone = phone.slice(2)
  return phone.length === 8 ? `505${phone}` : phone
}

export function whatsappUrl(value: string, message?: string) {
  const phone = normalizarTelefonoNicaragua(value)
  const text = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${phone}${text}`
}
