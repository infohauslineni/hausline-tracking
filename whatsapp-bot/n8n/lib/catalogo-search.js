// =====================================================================
//  Búsqueda del catálogo HAUSLINE · usada por el nodo Code del WF1
//  El catálogo se lee del JSON público que ya publica la web:
//    https://hauslineshopni.es/catalogo-productos.json
//  Fuente de verdad = productos.js de la web (este JSON es su espejo).
//
//  Pega el contenido dentro del nodo "Code · Buscar catálogo" del WF1,
//  o impórtalo si tu n8n permite módulos externos. Es JS puro sin deps.
// =====================================================================

// Marcas con casing/typos inconsistentes en el catálogo -> alias canónico.
const ALIAS_MARCAS = {
  'off white': 'off-white', 'offwhite': 'off-white',
  'louis vouitton': 'louis vuitton', 'louis vitton': 'louis vuitton',
  'dolce&gabanna': 'dolce & gabbana', 'dolce gabanna': 'dolce & gabbana',
  'd&g': 'dolce & gabbana', 'dolce & gabanna': 'dolce & gabbana',
  'loubutin': 'christian louboutin', 'louboutin': 'christian louboutin', 'cl': 'christian louboutin',
  'gg': 'golden goose', 'ppm': 'philip model', 'ami': 'ami paris',
};

const norm = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/\s+/g, ' ')
    .trim();

const canonMarca = (s) => {
  const n = norm(s);
  return ALIAS_MARCAS[n] || n;
};

// precio efectivo: oferta si > 0, si no venta.
function precioEfectivo(p) {
  const oferta = Number(p.precio_oferta ?? p.precioOferta ?? 0);
  const venta = Number(p.precio_venta ?? p.precioVenta ?? p.precio ?? 0);
  return oferta > 0 ? oferta : venta;
}

function enlaceProducto(p, catalogUrl) {
  const base = (catalogUrl || 'https://hauslineshopni.es').replace(/\/+$/, '');
  return `${base}/?producto=${encodeURIComponent(p.codigo || p.code || '')}`;
}

// Normaliza un producto del catálogo a la forma que consume el redactor.
function normalizarProducto(p, catalogUrl) {
  return {
    codigo: p.codigo || p.code || null,
    nombre: p.nombre || p.name || '',
    marca: p.marca || p.brand || null,
    categoria: p.categoria || p.category || null,
    tallas: p.tallas || p.sizes || [],
    colores: p.colores || p.colors || [],
    precio: precioEfectivo(p),
    precio_venta: Number(p.precio_venta ?? p.precioVenta ?? p.precio ?? 0),
    precio_oferta: Number(p.precio_oferta ?? p.precioOferta ?? 0),
    imagen: p.imagen || p.image || null,
    enlace: enlaceProducto(p, catalogUrl),
    tiempo_estimado: '15 a 25 días hábiles',
  };
}

/**
 * Busca productos por código, nombre, marca, categoría o palabras clave.
 * @param {Array} catalogo  array crudo del JSON público
 * @param {Object} opts     { code, term, catalogUrl, limit }
 * @returns {Array} productos normalizados, ordenados por relevancia
 */
function buscarCatalogo(catalogo, opts = {}) {
  const { code, term, catalogUrl, limit = 3 } = opts;
  const lista = Array.isArray(catalogo) ? catalogo : [];

  // 1) Coincidencia exacta por código (máxima prioridad).
  if (code) {
    const c = norm(code);
    const exacto = lista.find((p) => norm(p.codigo || p.code) === c);
    if (exacto) return [normalizarProducto(exacto, catalogUrl)];
  }

  if (!term) return [];

  const q = norm(term);
  const qMarca = canonMarca(term);
  const palabras = q.split(' ').filter(Boolean);

  const puntuar = (p) => {
    const nombre = norm(p.nombre || p.name);
    const marca = canonMarca(p.marca || p.brand);
    const categoria = norm(p.categoria || p.category);
    const codigo = norm(p.codigo || p.code);
    let score = 0;
    if (codigo === q) score += 100;
    if (marca === qMarca) score += 40;
    if (nombre.includes(q)) score += 30;
    if (categoria === q) score += 20;
    for (const w of palabras) {
      if (nombre.includes(w)) score += 6;
      if (marca.includes(w)) score += 5;
      if (categoria.includes(w)) score += 3;
    }
    // Solo productos activos / con stock si el flag existe.
    if (p.activo === false || p.disponible === false) score -= 1000;
    return score;
  };

  return lista
    .map((p) => ({ p, s: puntuar(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => normalizarProducto(x.p, catalogUrl));
}

// Export para nodo Code de n8n (module.exports) y para tests locales.
if (typeof module !== 'undefined') {
  module.exports = { buscarCatalogo, normalizarProducto, precioEfectivo, canonMarca, norm };
}
