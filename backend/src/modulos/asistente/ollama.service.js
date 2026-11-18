import entorno from '../../config/entorno.js';
import { ErrorApi } from '../../middlewares/errores.js';

async function llamar(ruta, cuerpo) {
  let respuesta;
  try {
    respuesta = await fetch(`${entorno.ollama.url}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(503, 'ASISTENTE_NO_DISPONIBLE', 'No se pudo conectar con Ollama.');
  }
  if (!respuesta.ok) {
    throw new ErrorApi(503, 'ASISTENTE_NO_DISPONIBLE', `Ollama respondió ${respuesta.status}: ${await respuesta.text()}`);
  }
  return respuesta.json();
}

export async function generarEmbeddings(textos) {
  const { embeddings } = await llamar('/api/embed', { model: entorno.ollama.modeloEmbeddings, input: textos });
  return embeddings;
}

export async function conversar(mensajes, formato) {
  const r = await llamar('/api/chat', {
    model: entorno.ollama.modeloChat,
    messages: mensajes,
    stream: false,
    ...(formato && { format: formato }),
    options: { temperature: 0 },
  });
  return {
    texto: r.message.content,
    tokensEntrada: r.prompt_eval_count ?? 0,
    tokensSalida: r.eval_count ?? 0,
  };
}
