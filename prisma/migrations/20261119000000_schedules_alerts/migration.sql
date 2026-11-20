-- Additive migration: existing rows are retained; no schedule is enabled automatically.
ALTER TABLE `analisis` ADD COLUMN `programado_para` DATETIME(3) NULL;

CREATE TABLE `programaciones_analisis` (
  `sitio_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `revision_dominio_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `configurado_por_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `intervalo_minutos` INTEGER UNSIGNED NOT NULL,
  `activa` BOOLEAN NOT NULL DEFAULT false,
  `proxima_ejecucion_en` DATETIME(3) NULL,
  `ultimo_estado` VARCHAR(50) NOT NULL,
  `actualizado_en` DATETIME(3) NOT NULL,
  PRIMARY KEY (`sitio_id`),
  INDEX `programaciones_analisis_activa_proxima_ejecucion_en_idx` (`activa`, `proxima_ejecucion_en`),
  INDEX `programaciones_analisis_revision_dominio_id_idx` (`revision_dominio_id`),
  INDEX `programaciones_analisis_configurado_por_id_idx` (`configurado_por_id`),
  CONSTRAINT `programaciones_analisis_sitio_id_fkey` FOREIGN KEY (`sitio_id`) REFERENCES `sitios` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `programaciones_analisis_revision_dominio_id_fkey` FOREIGN KEY (`revision_dominio_id`) REFERENCES `revisiones_dominio` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `programaciones_analisis_configurado_por_id_fkey` FOREIGN KEY (`configurado_por_id`) REFERENCES `usuarios` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `alertas` (
  `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `analisis_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `codigo_comprobacion` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `tipo` VARCHAR(50) NOT NULL,
  `clave_deduplicacion` CHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
  `detalle` JSON NOT NULL,
  `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `leida_en` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `alertas_clave_deduplicacion_key` (`clave_deduplicacion`),
  INDEX `alertas_analisis_id_creado_en_idx` (`analisis_id`, `creado_en`),
  CONSTRAINT `alertas_analisis_id_fkey` FOREIGN KEY (`analisis_id`) REFERENCES `analisis` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
