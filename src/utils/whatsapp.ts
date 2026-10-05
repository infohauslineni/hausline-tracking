export function limpiarTelefono(value: string) {
  return value.replace(/\D/g, '')
}

export function normalizarTelefonoNicaragua(value: string) {
  let phone = limpiarTelefono(value)
  if (phone.startsWith('00')) phone = phone.slice(2)
  return phone.length === 8 ? `505${phone}` : phone
}

// Los emojis (🛍️ ✅ 👋…) se dañan al abrir el chat con el enlace (sobre todo en WhatsApp de
// computadora) y le llegan al cliente como "◆?". Se quitan de todos los mensajes del panel.
export function sinEmojis(texto: string) {
  return texto
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

export function whatsappUrl(value: string, message?: string) {
  const phone = normalizarTelefonoNicaragua(value)
  const text = message ? `?text=${encodeURIComponent(sinEmojis(message))}` : ''
  return `https://wa.me/${phone}${text}`
}
