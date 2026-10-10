// Logo de Hausline Tracking: una "H" cuyo travesaño lleva un punto de rastreo (nodo),
// que representa el seguimiento del pedido. Minimalista y escalable (SVG).
export function HauslineLogo({ size = 40, className = '', glow = false }: { size?: number; className?: string; glow?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label="Hausline Tracking">
      {glow && <rect x="2" y="2" width="44" height="44" rx="13" fill="#f2ece0" opacity="0.18" style={{ filter: 'blur(8px)' }} />}
      <rect width="48" height="48" rx="13" fill="url(#hausline-tile)" />
      {/* Barras verticales de la H */}
      <rect x="12.6" y="11.5" width="5.4" height="25" rx="2.7" fill="#0a0a0a" />
      <rect x="30" y="11.5" width="5.4" height="25" rx="2.7" fill="#0a0a0a" />
      {/* Travesaño = ruta de rastreo */}
      <rect x="15.5" y="21.3" width="17" height="5.4" rx="2.7" fill="#0a0a0a" />
      {/* Nodo de rastreo al centro */}
      <circle cx="24" cy="24" r="4.9" fill="#f2ece0" stroke="#0a0a0a" strokeWidth="2.6" />
      <defs>
        <linearGradient id="hausline-tile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbf8f2" />
          <stop offset="1" stopColor="#d8d0c0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
