// Imagen "Nuevo en HAUSLINE" para Instagram, generada en el navegador (canvas) al subir un
// producto en el panel (admin.html) o desde el botón 📸 de la lista. Dos formatos:
//   · Post 4:5  (1080×1350)   · Story 9:16 (1080×1920)
// + el texto de la publicación listo para copiar. Se descarga como JPG y se programa en
// Meta Business Suite / Instagram. Usa los colores y fuentes de la tienda.
(function(){
  "use strict";
  var C = { fondo:"#F7F3EC", card:"#FFFFFF", borde:"#E7E3DC", tinta:"#171310", gris:"#6B655C", gris2:"#9C958A" };
  var SERIF = '"Cormorant Garamond", Georgia, serif';
  var SANS = 'Jost, "Segoe UI", Helvetica, Arial, sans-serif';
  var SITIO = "hauslineshopni.es";
  var WHATSAPP = "+505 7899 5116";

  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }

  // Foto del producto con CORS (sin esto el canvas queda "manchado" y no se puede descargar).
  function cargarImagen(src){
    return new Promise(function(res){
      if(!src){ res(null); return; }
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function(){ res(img); };
      img.onerror = function(){ res(null); };
      // Cache-bust en URLs absolutas: si el navegador ya la tenía sin CORS, la pediría manchada.
      img.src = /^https?:/i.test(src) ? src + (src.indexOf("?") < 0 ? "?" : "&") + "ig=1" : src;
    });
  }
  function fuentesListas(){
    if(!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('600 96px "Cormorant Garamond"'),
      document.fonts.load('500 40px "Cormorant Garamond"'),
      document.fonts.load('500 32px Jost'),
      document.fonts.load('600 26px Jost')
    ]).catch(function(){});
  }

  function rectRedondo(ctx, x, y, w, h, r){
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Texto centrado con letter-spacing (canvas no lo trae en todos los navegadores).
  function textoEspaciado(ctx, texto, cx, y, espacio){
    var chars = String(texto).split(""), ancho = 0;
    chars.forEach(function(c){ ancho += ctx.measureText(c).width + espacio; });
    ancho -= espacio;
    var x = cx - ancho / 2;
    ctx.textAlign = "left";
    chars.forEach(function(c){ ctx.fillText(c, x, y); x += ctx.measureText(c).width + espacio; });
    ctx.textAlign = "center";
  }
  // Parte el nombre en hasta `max` líneas que entren en `ancho`.
  function lineas(ctx, texto, ancho, max){
    var palabras = String(texto).split(/\s+/).filter(Boolean), out = [], linea = "";
    palabras.forEach(function(p){
      var prueba = linea ? linea + " " + p : p;
      if(ctx.measureText(prueba).width > ancho && linea){ out.push(linea); linea = p; } else linea = prueba;
    });
    if(linea) out.push(linea);
    if(out.length > max){ out = out.slice(0, max); out[max - 1] = out[max - 1].replace(/\s*\S*$/, "") + "…"; }
    return out;
  }

  // modo "inmediata": si el producto tiene precio propio de entrega inmediata, se usa ese.
  function precioTexto(p, modo){
    if(modo === "inmediata" && Number(p.precioEntregaInmediata) > 0){ var e = Number(p.precioEntregaInmediata); return "US$ " + (Number.isInteger(e) ? e : e.toFixed(2)); }
    if(p.cotizar || !(Number(p.precio) > 0)) return "Precio a consultar";
    var n = Number(p.precioOferta) > 0 ? Number(p.precioOferta) : Number(p.precio);
    return "US$ " + (Number.isInteger(n) ? n : n.toFixed(2));
  }
  function listaEI(p){
    var t = Array.isArray(p.tallasEntregaInmediata) ? p.tallasEntregaInmediata.filter(Boolean) : [];
    var c = Array.isArray(p.coloresEntregaInmediata) ? p.coloresEntregaInmediata.filter(Boolean) : [];
    return { tallas: t, colores: c };
  }

  // Textos de cada modo de la imagen.
  //   nuevo     → Nuevo ingreso (por encargo)
  //   inmediata → ya está en Nicaragua
  //   encamino  → viene en camino: se puede apartar ya con el 50%
  function textosModo(modo){
    if(modo === "inmediata") return { kicker: "ENTREGA INMEDIATA", titulo: "Disponible ya", sello: "LISTO PARA ENTREGAR", boton: "PEDILO EN ", subStory: "Ya en Nicaragua, sin esperar el encargo · ", piePost: "Ya en Nicaragua · pedilo en " + SITIO };
    if(modo === "encamino") return { kicker: "LLEGA PRONTO", titulo: "Apártelo ya", sello: "APARTE CON EL 50%", boton: "APÁRTELO EN ", subStory: "Resérvelo con el 50% · ", piePost: "Llega pronto · apártelo con el 50% en " + SITIO };
    return { kicker: "NUEVO INGRESO", titulo: "Nuevo en HAUSLINE", sello: "", boton: "ENCÁRGUELO EN ", subStory: "Envíos a toda Nicaragua · ", piePost: "Encárguelo en " + SITIO + " · Envíos a toda Nicaragua" };
  }
  function tallasModo(p, modo){
    if(modo === "encamino") return { tallas: (Array.isArray(p.tallasEnCamino) ? p.tallasEnCamino : []).filter(Boolean), colores: [] };
    if(modo === "inmediata") return listaEI(p);
    return { tallas: [], colores: [] };
  }

  function dibujar(canvas, p, img, formato, modo){
    var W = 1080, H = formato === "story" ? 1920 : 1350;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = C.fondo; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";

    var story = formato === "story";
    var tx = textosModo(modo);
    var conDetalle = modo === "inmediata" || modo === "encamino";
    var ei = tallasModo(p, modo);
    var y0 = story ? 190 : 120;

    // Encabezado
    ctx.fillStyle = C.gris; ctx.font = "600 26px " + SANS;
    textoEspaciado(ctx, tx.kicker, W / 2, y0, 9);
    ctx.fillStyle = C.tinta; ctx.font = "600 " + (story ? 104 : 92) + "px " + SERIF;
    ctx.fillText(tx.titulo, W / 2, y0 + (story ? 110 : 98));

    // Tarjeta con la foto
    var cx = 90, cw = W - 180, cy = y0 + (story ? 170 : 145), ch = story ? 920 : 715;
    ctx.save();
    ctx.shadowColor = "rgba(23,19,16,.08)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    rectRedondo(ctx, cx, cy, cw, ch, 36); ctx.fillStyle = C.card; ctx.fill();
    ctx.restore();
    rectRedondo(ctx, cx, cy, cw, ch, 36); ctx.strokeStyle = C.borde; ctx.lineWidth = 2; ctx.stroke();
    if(img){
      // La foto LLENA la tarjeta (recorte centrado): las fotos del catálogo traen su propio fondo.
      var s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      ctx.save(); rectRedondo(ctx, cx, cy, cw, ch, 36); ctx.clip();
      ctx.drawImage(img, cx + (cw - iw) / 2, cy + (ch - ih) / 2, iw, ih);
      ctx.restore();
    } else {
      ctx.fillStyle = C.gris2; ctx.font = "500 32px " + SANS; ctx.fillText("Foto del producto", W / 2, cy + ch / 2);
    }
    // Sello sobre la foto (entrega inmediata / en camino).
    if(tx.sello){
      ctx.font = "600 24px " + SANS;
      var sello = tx.sello, sw = 0;
      sello.split("").forEach(function(c){ sw += ctx.measureText(c).width + 3; });
      var pw = sw + 56, px = cx + 28, py = cy + 28;
      rectRedondo(ctx, px, py, pw, 58, 29); ctx.fillStyle = C.tinta; ctx.fill();
      ctx.fillStyle = C.fondo; textoEspaciado(ctx, sello, px + pw / 2, py + 38, 3);
    }

    // Nombre (+ tallas disponibles) + precio
    var yN = cy + ch + (story ? 100 : 72);
    ctx.fillStyle = C.tinta; ctx.font = "500 " + (story ? 44 : 38) + "px " + SANS;
    var ls = lineas(ctx, String(p.nombre || "").toUpperCase(), W - 200, conDetalle && !story ? 1 : 2);
    ls.forEach(function(l, i){ textoEspaciado(ctx, l, W / 2, yN + i * (story ? 56 : 48), 3); });
    var yUlt = yN + (ls.length - 1) * (story ? 56 : 48);
    if(conDetalle && (ei.tallas.length || ei.colores.length)){
      var det = (ei.tallas.length ? (ei.tallas.length === 1 ? "Talla " : "Tallas ") + ei.tallas.join(" · ") : "") + (ei.tallas.length && ei.colores.length ? "   |   " : "") + (ei.colores.length ? ei.colores.join(" · ") : "");
      yUlt += story ? 62 : 50;
      ctx.fillStyle = C.gris; ctx.font = "500 " + (story ? 34 : 30) + "px " + SANS;
      ctx.fillText(lineas(ctx, det, W - 200, 1)[0] || det, W / 2, yUlt);
    }
    var yP = yUlt + (story ? 96 : 78);
    ctx.fillStyle = C.tinta; ctx.font = "600 " + (story ? 80 : 68) + "px " + SERIF;
    ctx.fillText(precioTexto(p, modo), W / 2, yP);

    // Pie
    if(story){
      var bwid = 780, bx = (W - bwid) / 2, by = H - 260;
      rectRedondo(ctx, bx, by, bwid, 96, 48); ctx.fillStyle = C.tinta; ctx.fill();
      ctx.fillStyle = C.fondo; ctx.font = "600 30px " + SANS;
      textoEspaciado(ctx, tx.boton + SITIO.toUpperCase(), W / 2, by + 60, 2);
      ctx.fillStyle = C.gris; ctx.font = "500 28px " + SANS;
      ctx.fillText(tx.subStory + (p.codigo || ""), W / 2, H - 110);
    } else {
      ctx.fillStyle = C.gris; ctx.font = "500 28px " + SANS;
      ctx.fillText(tx.piePost, W / 2, H - 70);
    }
  }

  function textoPost(p, modo){
    if(modo === "encamino"){
      var tc = tallasModo(p, modo).tallas;
      return "🚚 Llega pronto a HAUSLINE · ¡Apártelo ya!\n\n"
        + (p.nombre || "") + "\n"
        + "💵 " + precioTexto(p) + "\n"
        + (tc.length ? "📏 " + (tc.length === 1 ? "Talla: " : "Tallas: ") + tc.join(" · ") + "\n" : "")
        + "⏳ Ya viene en camino: resérvelo hoy con el 50% y se lo entregamos apenas llegue\n\n"
        + "🛒 Apártelo en " + SITIO + "/p/" + encodeURIComponent(p.codigo || "") + "/\n"
        + "📲 WhatsApp " + WHATSAPP + "\n\n"
        + "#hausline #llegapronto #preventa #nicaragua #managua #sneakers #streetwear";
    }
    if(modo === "inmediata"){
      var ei = listaEI(p), cant = Number(p.cantidadDisponible) || 0;
      return "⚡ Entrega inmediata en HAUSLINE\n\n"
        + (p.nombre || "") + "\n"
        + "💵 " + precioTexto(p, modo) + "\n"
        + (ei.tallas.length ? "📏 " + (ei.tallas.length === 1 ? "Talla disponible: " : "Tallas disponibles: ") + ei.tallas.join(" · ") + "\n" : "")
        + (ei.colores.length ? "🎨 " + ei.colores.join(" · ") + "\n" : "")
        + "✅ Ya está en Nicaragua: se lo entregamos sin esperar el encargo" + (cant > 0 && cant <= 3 ? "\n🔥 Últimas " + cant + " unidades" : "") + "\n\n"
        + "🛒 Pídalo en " + SITIO + "/p/" + encodeURIComponent(p.codigo || "") + "/\n"
        + "📲 WhatsApp " + WHATSAPP + "\n\n"
        + "#hausline #entregainmediata #nicaragua #managua #sneakers #streetwear";
    }
    var dem = (typeof p.demoraExtendida !== "undefined" && p.demoraExtendida) ? "\n⏳ Este producto puede tardar un poco más de lo normal." : "";
    return "✨ Nuevo en HAUSLINE\n\n"
      + (p.nombre || "") + "\n"
      + "💵 " + precioTexto(p) + "\n"
      + "📦 Por encargo · envíos a toda Nicaragua" + dem + "\n\n"
      + "🛒 Encárguelo en " + SITIO + "/p/" + encodeURIComponent(p.codigo || "") + "/\n"
      + "📲 WhatsApp " + WHATSAPP + "\n\n"
      + "#hausline #nicaragua #managua #sneakers #streetwear #moda";
  }

  var CSS = ".hlig-ov{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.78);display:grid;place-items:center;padding:16px;overflow:auto}"
    + ".hlig-box{background:#141714;border:1px solid #2f362e;border-radius:18px;max-width:980px;width:100%;padding:20px;color:#eef1ec;font-family:inherit}"
    + ".hlig-h{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:6px}.hlig-h b{font-size:17px}"
    + ".hlig-x{background:none;border:1px solid #2f362e;color:#eef1ec;border-radius:10px;width:36px;height:36px;cursor:pointer;font-size:18px}"
    + ".hlig-sub{color:#99a299;font-size:12.5px;margin:0 0 14px}"
    + ".hlig-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:700px){.hlig-grid{grid-template-columns:1fr}}"
    + ".hlig-col{display:flex;flex-direction:column;gap:8px;align-items:stretch}.hlig-col small{color:#99a299;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700}"
    + ".hlig-col canvas{width:100%;height:auto;border-radius:12px;border:1px solid #2f362e;background:#F7F3EC}"
    + ".hlig-btn{display:inline-flex;justify-content:center;align-items:center;gap:8px;border:1px solid #b6f13c;background:#b6f13c;color:#0b0f08;border-radius:12px;padding:11px 14px;font-weight:700;font-size:13px;cursor:pointer}"
    + ".hlig-btn.sec{background:transparent;color:#eef1ec;border-color:#2f362e}"
    + ".hlig-txt{width:100%;min-height:150px;margin-top:14px;background:#0a0c0a;border:1px solid #2f362e;border-radius:12px;color:#eef1ec;padding:12px;font-size:13px;line-height:1.5;font-family:inherit;resize:vertical;box-sizing:border-box}"
    + ".hlig-fila{display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap}"
    + ".hlig-fotos{margin:0 0 14px}.hlig-fotos small{display:block;color:#99a299;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-bottom:7px}"
    + ".hlig-tira{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px}.hlig-ft{flex:none;width:62px;height:62px;border-radius:10px;border:2px solid #2f362e;padding:0;overflow:hidden;cursor:pointer;background:#0a0c0a;position:relative}"
    + ".hlig-ft img{width:100%;height:100%;object-fit:cover;display:block}.hlig-ft.on{border-color:#b6f13c;box-shadow:0 0 0 2px rgba(182,241,60,.35)}.hlig-ft.on::after{content:'✓';position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:50%;background:#b6f13c;color:#0b0f08;font-size:10px;font-weight:800;display:grid;place-items:center}"
    + ".hlig-pub{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;padding:12px;border:1px solid #2f362e;border-radius:12px;background:#0d100d}.hlig-pub label{display:flex;align-items:center;gap:6px;font-size:13px;color:#eef1ec;cursor:pointer}.hlig-pub [data-pubest]{font-size:12.5px;color:#99a299;flex-basis:100%}.hlig-pub [data-pubest] a{color:#b6f13c}"
    + ".hlig-modos{display:flex;gap:6px;margin:0 0 14px;flex-wrap:wrap}.hlig-modo{border:1px solid #2f362e;background:transparent;color:#eef1ec;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:700;cursor:pointer}.hlig-modo.on{background:#eef1ec;color:#0b0f08;border-color:#eef1ec}";

  function slug(s){ return String(s || "producto").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40); }
  function descargar(canvas, nombre){
    canvas.toBlob(function(blob){
      if(!blob) return;
      var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 4000);
    }, "image/jpeg", 0.92);
  }

  // p = datos del producto del panel: { codigo, nombre, precio, precioOferta, cotizar, imagen, demoraExtendida,
  //   entregaInmediata, tallasEntregaInmediata, coloresEntregaInmediata, precioEntregaInmediata }
  // modo = "nuevo" (Nuevo ingreso) | "inmediata" (Entrega inmediata). Sin modo: inmediata si el producto la tiene.
  async function abrir(p, modo){
    if(!p) return;
    var conEI = !!p.entregaInmediata, conEC = !!p.enCamino;
    modo = modo === "inmediata" || modo === "nuevo" || modo === "encamino" ? modo : (conEI ? "inmediata" : conEC ? "encamino" : "nuevo");
    // Todas las fotos del producto (sin repetir), para elegir cuál sale en el post y la story.
    var fotos = [p.imagen].concat(Array.isArray(p.imagenes) ? p.imagenes : []).map(function(u){ return String(u || "").trim(); })
      .filter(function(u, i, a){ return u && a.indexOf(u) === i; });
    if(!document.getElementById("hlig-css")){ var st = document.createElement("style"); st.id = "hlig-css"; st.textContent = CSS; document.head.appendChild(st); }
    var ov = document.createElement("div"); ov.className = "hlig-ov";
    ov.innerHTML = '<div class="hlig-box" role="dialog" aria-modal="true" aria-label="Imagen para Instagram">'
      + '<div class="hlig-h"><b>📸 Imagen para Instagram · ' + esc(p.codigo || "") + '</b><button class="hlig-x" type="button" data-cerrar aria-label="Cerrar">✕</button></div>'
      + '<p class="hlig-sub">Descargala y programala en Meta Business Suite (post y story). El texto de abajo va de descripción.</p>'
      + (fotos.length > 1 ? '<div class="hlig-fotos"><small>Foto para el post y la story · tocá para cambiarla</small><div class="hlig-tira">'
        + fotos.map(function(u, i){ return '<button class="hlig-ft' + (i ? '' : ' on') + '" type="button" data-f="' + i + '" aria-label="Usar foto ' + (i + 1) + '"><img src="' + esc(u) + '" alt="" loading="lazy"></button>'; }).join("")
        + '</div></div>' : '')
      + (conEI || conEC || modo !== "nuevo" ? '<div class="hlig-modos">' + (conEC || modo === "encamino" ? '<button class="hlig-modo" type="button" data-m="encamino">🚚 Llega pronto</button>' : '') + (conEI || modo === "inmediata" ? '<button class="hlig-modo" type="button" data-m="inmediata">⚡ Entrega inmediata</button>' : '') + '<button class="hlig-modo" type="button" data-m="nuevo">✨ Nuevo ingreso</button></div>' : '')
      + '<div class="hlig-grid"><div class="hlig-col"><small>Post · 4:5</small><canvas data-c="post"></canvas><button class="hlig-btn" type="button" data-d="post">⬇ Descargar post</button></div>'
      + '<div class="hlig-col"><small>Story · 9:16</small><canvas data-c="story" style="max-height:560px;object-fit:contain"></canvas><button class="hlig-btn" type="button" data-d="story">⬇ Descargar story</button></div></div>'
      + '<textarea class="hlig-txt" data-t aria-label="Texto de la publicación"></textarea>'
      + (typeof window.HLInstagramPublicar === "function" ? '<div class="hlig-pub"><label><input type="checkbox" data-pp checked> Post (con el texto)</label><label><input type="checkbox" data-ps checked> Story</label><button class="hlig-btn" type="button" data-publicar>📲 Publicar en Instagram</button><span data-pubest>Se publica directo en tu cuenta de Instagram, con la foto y el texto que ves arriba (podés editar el texto).</span></div>' : '')
      + '<div class="hlig-fila"><button class="hlig-btn sec" type="button" data-copiar>Copiar texto</button><button class="hlig-btn sec" type="button" data-cerrar>Listo</button></div></div>';
    document.body.appendChild(ov);
    var cerrar = function(){ ov.remove(); document.removeEventListener("keydown", onKey); };
    var onKey = function(e){ if(e.key === "Escape") cerrar(); };
    document.addEventListener("keydown", onKey);
    ov.addEventListener("click", function(e){ if(e.target === ov) cerrar(); });
    ov.querySelectorAll("[data-cerrar]").forEach(function(b){ b.addEventListener("click", cerrar); });
    var txt = ov.querySelector("[data-t]");
    ov.querySelector("[data-copiar]").addEventListener("click", function(e){
      var b = e.currentTarget;
      (navigator.clipboard ? navigator.clipboard.writeText(txt.value) : Promise.reject()).catch(function(){ txt.select(); document.execCommand("copy"); })
        .then(function(){ b.textContent = "✓ Copiado"; setTimeout(function(){ b.textContent = "Copiar texto"; }, 1600); });
    });

    await fuentesListas();
    var img = await cargarImagen(fotos[0] || "");
    // conTexto: el texto se rehace al cambiar de modo, no al cambiar de foto (así no se pierde lo editado).
    var pintar = function(conTexto){
      ov.querySelectorAll("[data-m]").forEach(function(b){ b.classList.toggle("on", b.getAttribute("data-m") === modo); });
      if(conTexto) txt.value = textoPost(p, modo);
      ["post", "story"].forEach(function(f){ dibujar(ov.querySelector('[data-c="' + f + '"]'), p, img, f, modo); });
    };
    ov.querySelectorAll("[data-m]").forEach(function(b){ b.addEventListener("click", function(){ modo = b.getAttribute("data-m"); pintar(true); }); });
    pintar(true);
    // Elegir otra foto: se carga (con CORS, para poder descargar) y se redibuja todo.
    var pedidoFoto = 0;
    ov.querySelectorAll("[data-f]").forEach(function(b){ b.addEventListener("click", async function(){
      var n = ++pedidoFoto, i = Number(b.getAttribute("data-f"));
      ov.querySelectorAll("[data-f]").forEach(function(x){ x.classList.toggle("on", x === b); });
      var nueva = await cargarImagen(fotos[i]);
      if(n !== pedidoFoto) return;   // tocó otra foto mientras cargaba
      if(!nueva){ alert("Esa foto no se pudo usar para la imagen. Probá con otra."); return; }
      img = nueva; pintar();
    }); });
    ["post", "story"].forEach(function(f){
      var cv = ov.querySelector('[data-c="' + f + '"]');
      ov.querySelector('[data-d="' + f + '"]').addEventListener("click", function(){
        try{ descargar(cv, "hausline-" + slug(p.codigo || p.nombre) + (modo === "inmediata" ? "-inmediata" : "") + "-" + f + ".jpg"); }
        catch(err){ alert("No se pudo descargar la imagen (la foto no permite exportarse). Probá con otra foto del producto."); }
      });
    });

    // Publicar directo en Instagram (admin.js define window.HLInstagramPublicar: sube los JPG y
    // llama a la API del panel, que usa la API oficial de Meta).
    var btnPub = ov.querySelector("[data-publicar]");
    if(btnPub) btnPub.addEventListener("click", async function(){
      var est = ov.querySelector("[data-pubest]");
      var conPost = ov.querySelector("[data-pp]").checked, conStory = ov.querySelector("[data-ps]").checked;
      if(!conPost && !conStory){ est.textContent = "Elegí post, story o los dos."; return; }
      if(!confirm("¿Publicar ahora en Instagram " + (conPost && conStory ? "el post y la story" : conPost ? "el post" : "la story") + " de " + (p.codigo || "este producto") + "?")) return;
      var blob = function(f){ return new Promise(function(res){ try{ ov.querySelector('[data-c="' + f + '"]').toBlob(res, "image/jpeg", 0.92); }catch(e){ res(null); } }); };
      btnPub.disabled = true; var t0 = btnPub.textContent; btnPub.textContent = "Publicando…"; est.textContent = "Subiendo las imágenes y publicando (puede tardar unos segundos)…";
      try{
        var post = conPost ? await blob("post") : null, story = conStory ? await blob("story") : null;
        if((conPost && !post) || (conStory && !story)) throw new Error("La foto no permite exportarse. Probá con otra foto del producto.");
        var r = await window.HLInstagramPublicar({ codigo: p.codigo || slug(p.nombre), post: post, story: story, caption: txt.value });
        var links = [r.post && r.post.permalink ? '<a href="' + esc(r.post.permalink) + '" target="_blank" rel="noopener">ver post</a>' : (r.post ? "post publicado" : ""), r.story ? "story publicada" : ""].filter(Boolean).join(" · ");
        est.innerHTML = "✅ Listo en Instagram: " + links + (r.errorStory ? ' · <span style="color:#f5a524">la story no salió: ' + esc(r.errorStory) + "</span>" : "");
        btnPub.textContent = "✓ Publicado";
      }catch(err){
        est.innerHTML = '<span style="color:#ff8a8a">' + esc(err && err.message || "No se pudo publicar.") + "</span>";
        btnPub.disabled = false; btnPub.textContent = t0;
      }
    });
  }

  window.HLInstagram = { abrir: abrir };
})();
