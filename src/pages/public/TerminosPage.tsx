import { LegalLayout, LegalSection } from '../../components/layout/LegalLayout'

export function TerminosPage() {
  return <LegalLayout title="Términos y condiciones" updated="26 de agosto de 2026">
    <p>
      Al realizar un pedido con Hausline (King of Shoes) aceptás las siguientes condiciones de compra, tiempos
      de entrega y garantía. Te recomendamos leerlas antes de confirmar tu compra.
    </p>

    <LegalSection title="1. Condiciones de compra">
      <ul className="list-disc space-y-1 pl-5">
        <li>Todos los pedidos son bajo encargo, salvo los productos marcados como <strong className="text-white">entrega inmediata</strong>.</li>
        <li>El pedido se confirma con un <strong className="text-white">abono del 50%</strong> del valor total.</li>
        <li>El saldo restante se paga antes de la entrega, una vez que el pedido está disponible.</li>
        <li>Una vez confirmado el pedido <strong className="text-white">no se aceptan cancelaciones</strong>, porque la compra internacional ya se gestiona con el proveedor.</li>
        <li>Los precios se muestran en dólares (USD) y su equivalente en córdobas (C$). El monto en córdobas puede ajustarse según el tipo de cambio del día.</li>
      </ul>
    </LegalSection>

    <LegalSection title="2. Formas de pago">
      <p>
        Aceptamos transferencia bancaria y pagos coordinados por WhatsApp. Al confirmar tu encargo te
        enviamos los números de cuenta y el detalle de tu abono. Guardá tu comprobante hasta recibir el producto.
      </p>
    </LegalSection>

    <LegalSection title="3. Tiempos de entrega">
      <ul className="list-disc space-y-1 pl-5">
        <li><strong className="text-white">Envío estándar:</strong> 20 a 25 días, sin costo adicional.</li>
        <li><strong className="text-white">Envío rápido:</strong> 14 a 17 días, con un costo adicional de $15 por producto.</li>
        <li><strong className="text-white">Entrega inmediata:</strong> los productos disponibles en stock se entregan sin espera.</li>
        <li>Los tiempos son estimados y pueden variar por la logística internacional, aduanas o fechas festivas.</li>
      </ul>
      <p>
        Podés seguir tu pedido en todo momento en nuestra <a className="text-accent" href="/tracking">página de rastreo</a> con el código HS que te entregamos al confirmar la compra.
      </p>
    </LegalSection>

    <LegalSection title="4. Retiro y bodega">
      <ul className="list-disc space-y-1 pl-5">
        <li>Cuando tu pedido queda <strong className="text-white">disponible para entrega</strong>, tenés 2 días para confirmar el retiro o el envío sin costo de bodega.</li>
        <li>Después de esos 2 días se aplica un cargo de <strong className="text-white">USD 5 por cada día</strong> que el pedido permanezca en bodega.</li>
        <li>El costo del envío a domicilio depende de tu ubicación y se coordina por WhatsApp.</li>
      </ul>
    </LegalSection>

    <LegalSection title="5. Garantía">
      <ul className="list-disc space-y-1 pl-5">
        <li>Garantía de <strong className="text-white">24 horas por defectos de fábrica</strong> a partir de la entrega.</li>
        <li>Revisá tu pedido al momento de recibirlo y reportá cualquier problema de inmediato.</li>
        <li>La garantía no cubre daños por mal uso, desgaste normal ni modificaciones hechas al producto.</li>
        <li>Por tratarse de productos importados bajo encargo, no se aceptan devoluciones por cambio de opinión, talla o color una vez entregado.</li>
      </ul>
    </LegalSection>

    <LegalSection title="6. Responsabilidad">
      <p>
        Nos esforzamos por describir los productos con la mayor exactitud posible. Las imágenes son
        referenciales y pueden variar ligeramente en color según la pantalla. Ante cualquier duda, escribinos
        antes de confirmar tu pedido.
      </p>
    </LegalSection>

    <LegalSection title="7. Contacto">
      <p>
        ¿Dudas sobre tu pedido o estas condiciones?<br />
        Correo: <a className="text-accent" href="mailto:alerta@hauslineshopni.es">alerta@hauslineshopni.es</a><br />
        WhatsApp: <a className="text-accent" href="https://wa.me/50578995116" target="_blank" rel="noopener noreferrer">+505 7899 5116</a>
      </p>
    </LegalSection>
  </LegalLayout>
}
