-- Ejercicio: tokens del modelo de lenguaje consumidos por la acción (entrada + salida). NULL si no usó ninguno.
USE vacunacion_ddriss;

ALTER TABLE bitacora
  ADD COLUMN tokens_consumidos INT UNSIGNED NULL AFTER agente_usuario;
