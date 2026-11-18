import { cliente } from '../src/config/mongodb.js';
import { ingerirDocumentos } from '../src/modulos/asistente/rag.service.js';

try {
  const { ingeridos, sinCambios, retirados } = await ingerirDocumentos();
  for (const { documento, fragmentos } of ingeridos) console.log(`Ingerido: ${documento} (${fragmentos} fragmentos)`);
  for (const documento of sinCambios) console.log(`Sin cambios: ${documento}`);
  for (const documento of retirados) console.log(`Retirado: ${documento}`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await cliente.close();
}
