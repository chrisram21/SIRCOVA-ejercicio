import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import entorno from '../../config/entorno.js';
import { obtenerDb } from '../../config/mongodb.js';
import { generarEmbeddings } from './ollama.service.js';

const COLECCION = 'rag_fragmentos';
const LARGO_FRAGMENTO = 1000;
const LOTE_EMBEDDINGS = 16;
const EXTENSIONES = new Set(['.md', '.txt']);

function partirLargo(texto) {
  const partes = [];
  let actual = '';
  for (const linea of texto.split('\n')) {
    if (actual && actual.length + linea.length > LARGO_FRAGMENTO) {
      partes.push(actual);
      actual = '';
    }
    actual += (actual ? '\n' : '') + linea;
  }
  if (actual) partes.push(actual);
  return partes;
}

// Cada fragmento lleva el último título visto para que conserve su contexto al buscarlo solo.
export function fragmentar(texto) {
  const fragmentos = [];
  let titulo = '';
  let actual = '';
  const cerrar = () => {
    if (actual.trim()) fragmentos.push(titulo && !actual.startsWith(titulo) ? `${titulo}\n${actual}` : actual);
    actual = '';
  };
  for (const parrafo of texto.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const limpio = parrafo.trim();
    if (!limpio) continue;
    if (/^#{1,6}\s/.test(limpio)) {
      cerrar();
      titulo = limpio.split('\n')[0];
    }
    for (const parte of partirLargo(limpio)) {
      if (actual && actual.length + parte.length > LARGO_FRAGMENTO) cerrar();
      actual += (actual ? '\n\n' : '') + parte;
    }
  }
  cerrar();
  return fragmentos;
}

async function embeddingsPorLotes(textos) {
  const vectores = [];
  for (let i = 0; i < textos.length; i += LOTE_EMBEDDINGS) {
    vectores.push(...(await generarEmbeddings(textos.slice(i, i + LOTE_EMBEDDINGS))));
  }
  return vectores;
}

export async function ingerirDocumentos(carpeta = entorno.rutaDocumentosRag) {
  const coleccion = (await obtenerDb()).collection(COLECCION);
  await coleccion.createIndex({ documento: 1, indice: 1 }, { unique: true });

  const archivos = (await fs.readdir(carpeta)).filter((a) => EXTENSIONES.has(path.extname(a).toLowerCase())).sort();
  const resumen = { ingeridos: [], sinCambios: [], retirados: [] };

  for (const archivo of archivos) {
    const contenido = await fs.readFile(path.join(carpeta, archivo), 'utf8');
    const hash = createHash('sha256').update(contenido).digest('hex');
    if (await coleccion.findOne({ documento: archivo, hash })) {
      resumen.sinCambios.push(archivo);
      continue;
    }
    const textos = fragmentar(contenido);
    const vectores = await embeddingsPorLotes(textos);
    await coleccion.deleteMany({ documento: archivo });
    await coleccion.insertMany(textos.map((texto, indice) => ({
      documento: archivo,
      indice,
      texto,
      embedding: vectores[indice],
      hash,
      ingeridoEn: new Date(),
    })));
    resumen.ingeridos.push({ documento: archivo, fragmentos: textos.length });
  }

  const sobrantes = (await coleccion.distinct('documento')).filter((d) => !archivos.includes(d));
  if (sobrantes.length > 0) await coleccion.deleteMany({ documento: { $in: sobrantes } });
  resumen.retirados = sobrantes;
  return resumen;
}

function similitudCoseno(a, b) {
  let producto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i += 1) {
    producto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  return producto / (Math.sqrt(normaA) * Math.sqrt(normaB) || 1);
}

export async function buscarFragmentos(pregunta, cantidad) {
  const [vector] = await generarEmbeddings([pregunta]);
  const fragmentos = await (await obtenerDb())
    .collection(COLECCION)
    .find({}, { projection: { documento: 1, indice: 1, texto: 1, embedding: 1 } })
    .toArray();
  return fragmentos
    .map((f) => ({ documento: f.documento, indice: f.indice, texto: f.texto, similitud: similitudCoseno(vector, f.embedding) }))
    .sort((a, b) => b.similitud - a.similitud)
    .slice(0, cantidad);
}
