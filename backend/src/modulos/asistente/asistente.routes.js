import { Router } from 'express';
import * as asistenteController from './asistente.controller.js';
import { autenticar } from '../../middlewares/autenticar.js';

const router = Router();

router.post('/asistente/preguntar', autenticar, asistenteController.preguntar);

export default router;
