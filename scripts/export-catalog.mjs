import fs from 'node:fs'
import vm from 'node:vm'

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) throw new Error('Uso: node export-catalog.mjs app.js catalogo-productos.json')
const source = fs.readFileSync(input, 'utf8')
const start = source.indexOf('const productos =')
const end = source.indexOf('\n];', start)
if (start < 0 || end < 0) throw new Error('No se encontró el arreglo de productos.')
const expression = source.slice(source.indexOf('[', start), end + 2)
const products = vm.runInNewContext(expression)
const normalized = products.filter(Boolean).map((product) => ({
  codigo: String(product.codigo || '').trim(),
  nombre: String(product.nombre || '').trim(),
  marca: product.marca ? String(product.marca).trim() : null,
  categoria: product.categoria ? String(product.categoria).trim() : null,
  tallas: Array.isArray(product.tallas) ? product.tallas.filter(Boolean).map(String) : [],
  precio_venta: Number(product.precio || 0),
  imagen: product.imagen || null,
  descripcion: product.descripcion || null,
})).filter((product) => product.codigo && product.nombre)
fs.writeFileSync(output, JSON.stringify(normalized, null, 2) + '\n')
console.log(`${normalized.length} productos exportados.`)
