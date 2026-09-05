import { LegalLayout, LegalSection } from '../../components/layout/LegalLayout'

export function PrivacidadPage() {
  return <LegalLayout title="Política de privacidad" updated="26 de agosto de 2026">
    <p>
      En Hausline (King of Shoes) respetamos tu privacidad. Esta política explica qué datos recolectamos,
      para qué los usamos y qué derechos tenés sobre ellos cuando comprás con nosotros o usás nuestra
      página de rastreo de pedidos.
    </p>

    <LegalSection title="1. Qué datos recolectamos">
      <ul className="list-disc space-y-1 pl-5">
        <li><strong className="text-white">Datos de contacto:</strong> nombre, teléfono/WhatsApp, correo y ciudad o dirección de entrega.</li>
        <li><strong className="text-white">Datos del pedido:</strong> productos encargados, talla, color, montos, abonos y estado del envío.</li>
        <li><strong className="text-white">Datos técnicos:</strong> información básica del navegador y cookies (ver la sección de cookies).</li>
      </ul>
      <p>Solo pedimos los datos necesarios para procesar y entregar tu pedido.</p>
    </LegalSection>

    <LegalSection title="2. Para qué usamos tus datos">
      <ul className="list-disc space-y-1 pl-5">
        <li>Confirmar, preparar y entregar tu pedido.</li>
        <li>Mostrarte el estado de tu envío en la página de rastreo con tu código HS.</li>
        <li>Comunicarnos con vos por WhatsApp o correo sobre tu compra.</li>
        <li>Cumplir con obligaciones administrativas y contables.</li>
      </ul>
      <p>No vendemos ni alquilamos tus datos personales a terceros.</p>
    </LegalSection>

    <LegalSection title="3. Con quién los compartimos">
      <p>
        Compartimos únicamente lo indispensable con los proveedores que hacen posible tu pedido: agencias de
        compra y envío internacional, servicios de mensajería local y las plataformas que alojan nuestra tienda
        y sistema de rastreo. Estos proveedores solo pueden usar la información para prestarnos su servicio.
      </p>
    </LegalSection>

    <LegalSection title="4. Cookies y rastreo">
      <p>
        Usamos cookies necesarias para que la página funcione (por ejemplo, recordar tu carrito o tu preferencia
        de cookies). Con tu autorización podríamos usar además cookies de rastreo o analítica para entender cómo
        se usa el sitio y mejorarlo. Al ingresar te mostramos un banner donde podés <strong className="text-white">aceptar
        o rechazar</strong> el rastreo; podés cambiar de opinión borrando las cookies desde tu navegador.
      </p>
    </LegalSection>

    <LegalSection title="5. Cuánto tiempo conservamos tus datos">
      <p>
        Conservamos los datos de tu pedido mientras sea necesario para darte seguimiento, atender garantías y
        cumplir con nuestras obligaciones. Luego los eliminamos o los guardamos de forma anonimizada.
      </p>
    </LegalSection>

    <LegalSection title="6. Tus derechos">
      <p>
        Podés pedirnos acceder, corregir o eliminar tus datos personales, así como retirar tu consentimiento.
        Escribinos a <a className="text-accent" href="mailto:alerta@hauslineshopni.es">alerta@hauslineshopni.es</a> o
        por WhatsApp al <a className="text-accent" href="https://wa.me/50578995116" target="_blank" rel="noopener noreferrer">+505 7899 5116</a>.
      </p>
    </LegalSection>

    <LegalSection title="7. Contacto">
      <p>
        Hausline · King of Shoes<br />
        Correo: <a className="text-accent" href="mailto:alerta@hauslineshopni.es">alerta@hauslineshopni.es</a><br />
        WhatsApp: <a className="text-accent" href="https://wa.me/50578995116" target="_blank" rel="noopener noreferrer">+505 7899 5116</a>
      </p>
    </LegalSection>
  </LegalLayout>
}
