// Foto de perfil del cliente (la de su "Mi cuenta" en la tienda) o su inicial si no tiene.
export function ClienteAvatar({ nombre, url, size = 40 }: { nombre: string; url?: string | null; size?: number }) {
  const estilo = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  if (url) return <img src={url} alt={nombre} style={estilo} className="shrink-0 rounded-full border border-line object-cover" loading="lazy" />
  return <span style={estilo} className="grid shrink-0 place-items-center rounded-full bg-accent/10 font-semibold uppercase text-accent">{(nombre || '?').trim().charAt(0)}</span>
}
