import { enTransaccion } from '../../config/mysql.js';
import { ACCIONES, MODULOS, registrarBitacora } from '../auditoria/auditoria.service.js';
import { entradaInvalida, revisarCampos } from '../catalogos/catalogos.service.js';
import { conversar } from './ollama.service.js';
import { buscarFragmentos } from './rag.service.js';

const FRAGMENTOS_POR_PREGUNTA = 4;
const LARGO_MAXIMO_PREGUNTA = 500;

const INSTRUCCIONES = `Eres el asistente de SIRCOVA, el sistema de producción de vacunación de la DDRISS San Marcos.
Responde en español y solo con la información de los fragmentos que recibes.
En "fuentes" pon el nombre del documento de cada fragmento que usaste para responder.
Si la respuesta no está en los fragmentos, dilo y deja "fuentes" vacío.`;

// Con un enum, el modelo solo puede citar documentos que de verdad recibió.
const formatoRespuesta = (documentos) => ({
  type: 'object',
  properties: {
    respuesta: { type: 'string' },
    fuentes: { type: 'array', items: { type: 'string', enum: documentos } },
  },
  required: ['respuesta', 'fuentes'],
});

function leerPregunta(cuerpo) {
  revisarCampos(cuerpo, ['pregunta']);
  const pregunta = typeof cuerpo?.pregunta === 'string' ? cuerpo.pregunta.trim() : '';
  if (pregunta.length < 3 || pregunta.length > LARGO_MAXIMO_PREGUNTA) {
    throw entradaInvalida(`pregunta debe tener de 3 a ${LARGO_MAXIMO_PREGUNTA} caracteres.`);
  }
  return pregunta;
}

function leerSalida(texto, documentos) {
  try {
    const salida = JSON.parse(texto);
    const citados = Array.isArray(salida.fuentes) ? salida.fuentes.filter((d) => documentos.includes(d)) : [];
    return { respuesta: String(salida.respuesta ?? ''), citados: [...new Set(citados)] };
  } catch {
    return { respuesta: texto, citados: [] };
  }
}

const redondear = (similitud) => Number(similitud.toFixed(4));

export async function preguntar(cuerpo, contexto) {
  const pregunta = leerPregunta(cuerpo);
  const fragmentos = await buscarFragmentos(pregunta, FRAGMENTOS_POR_PREGUNTA);
  const documentos = [...new Set(fragmentos.map((f) => f.documento))];
  const textoContexto = fragmentos.map((f) => `(documento: ${f.documento})\n${f.texto}`).join('\n\n---\n\n');

  const { texto, tokensEntrada, tokensSalida } = await conversar(
    [
      { role: 'system', content: INSTRUCCIONES },
      { role: 'user', content: `Fragmentos:\n\n${textoContexto}\n\nPregunta: ${pregunta}` },
    ],
    formatoRespuesta(documentos),
  );

  const { respuesta, citados } = leerSalida(texto, documentos);
  const fuentes = citados.map((documento) => {
    const propios = fragmentos.filter((f) => f.documento === documento);
    return {
      documento,
      fragmentos: propios.map((f) => f.indice),
      similitud: redondear(Math.max(...propios.map((f) => f.similitud))),
    };
  });
  const tokens = { entrada: tokensEntrada, salida: tokensSalida, total: tokensEntrada + tokensSalida };

  await enTransaccion((conexion) => registrarBitacora(conexion, {
    ...contexto,
    modulo: MODULOS.SISTEMA,
    accion: ACCIONES.CONSULTAR_ASISTENTE,
    entidad: 'rag_fragmentos',
    valoresNuevos: { pregunta, fuentes: citados },
    tokensConsumidos: tokens.total,
  }));

  return {
    pregunta,
    respuesta,
    fuentes,
    fragmentosConsultados: fragmentos.map((f) => ({
      documento: f.documento,
      fragmento: f.indice,
      similitud: redondear(f.similitud),
    })),
    tokens,
  };
}
