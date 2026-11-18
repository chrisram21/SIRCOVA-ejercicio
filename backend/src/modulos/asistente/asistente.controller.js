import * as asistenteService from './asistente.service.js';
import { contextoAuditoria } from '../auditoria/auditoria.service.js';

export async function preguntar(req, res) {
  res.json(await asistenteService.preguntar(req.body, contextoAuditoria(req)));
}
