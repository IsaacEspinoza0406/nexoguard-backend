-- CreateTable
CREATE TABLE `usuarios` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `correo_original` VARCHAR(254) NOT NULL,
    `correo_normalizado` VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `usuarios_correo_normalizado_key`(`correo_normalizado`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sesiones` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `usuario_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    `identificador_hash` BINARY(32) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ultimo_uso_en` DATETIME(3) NOT NULL,
    `expira_absoluto_en` DATETIME(3) NOT NULL,
    `revocado_en` DATETIME(3) NULL,

    UNIQUE INDEX `sesiones_identificador_hash_key`(`identificador_hash`),
    INDEX `sesiones_usuario_id_idx`(`usuario_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sitios` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `propietario_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `dominio_canonico` VARCHAR(253) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `revision_actual_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sitios_propietario_id_dominio_canonico_key`(`propietario_id`, `dominio_canonico`),
    UNIQUE INDEX `sitios_revision_actual_id_id_dominio_canonico_key`(`revision_actual_id`, `id`, `dominio_canonico`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `revisiones_dominio` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `sitio_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `numero_revision` INTEGER UNSIGNED NOT NULL,
    `dominio_canonico` VARCHAR(253) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `revisiones_dominio_sitio_id_numero_revision_key`(`sitio_id`, `numero_revision`),
    UNIQUE INDEX `revisiones_dominio_id_sitio_id_dominio_canonico_key`(`id`, `sitio_id`, `dominio_canonico`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `verificaciones_dominio` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `revision_dominio_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `codigo_hash` BINARY(32) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `desafio_expira_en` DATETIME(3) NOT NULL,
    `verificado_en` DATETIME(3) NULL,
    `verificacion_valida_hasta` DATETIME(3) NULL,
    `invalidado_en` DATETIME(3) NULL,

    INDEX `verificaciones_dominio_revision_dominio_id_creado_en_idx`(`revision_dominio_id`, `creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `analisis` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `verificacion_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `estado` ENUM('PENDIENTE', 'EN_EJECUCION', 'COMPLETADO', 'FALLIDO') NOT NULL,
    `procedencia` VARCHAR(50) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `iniciado_en` DATETIME(3) NULL,
    `finalizado_en` DATETIME(3) NULL,
    `motivo_fallo` VARCHAR(255) NULL,
    `version_reclamo` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `intentos` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `reclamo_expira_en` DATETIME(3) NULL,
    `disponible_en` DATETIME(3) NOT NULL,

    INDEX `analisis_verificacion_id_creado_en_idx`(`verificacion_id`, `creado_en`),
    INDEX `analisis_estado_disponible_en_idx`(`estado`, `disponible_en`),
    INDEX `analisis_estado_reclamo_expira_en_idx`(`estado`, `reclamo_expira_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `resultados_comprobacion` (
    `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `analisis_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `codigo_comprobacion` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin NOT NULL,
    `estado` ENUM('APROBADO', 'HALLAZGO', 'NO_APLICABLE', 'NO_EVALUADO') NOT NULL,
    `evidencia` JSON NULL,
    `observado_en` DATETIME(3) NULL,

    UNIQUE INDEX `resultados_comprobacion_analisis_id_codigo_comprobacion_key`(`analisis_id`, `codigo_comprobacion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sesiones` ADD CONSTRAINT `sesiones_usuario_id_fkey` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sitios` ADD CONSTRAINT `sitios_propietario_id_fkey` FOREIGN KEY (`propietario_id`) REFERENCES `usuarios`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sitios` ADD CONSTRAINT `sitios_revision_actual_id_id_dominio_canonico_fkey` FOREIGN KEY (`revision_actual_id`, `id`, `dominio_canonico`) REFERENCES `revisiones_dominio`(`id`, `sitio_id`, `dominio_canonico`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `revisiones_dominio` ADD CONSTRAINT `revisiones_dominio_sitio_id_fkey` FOREIGN KEY (`sitio_id`) REFERENCES `sitios`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `verificaciones_dominio` ADD CONSTRAINT `verificaciones_dominio_revision_dominio_id_fkey` FOREIGN KEY (`revision_dominio_id`) REFERENCES `revisiones_dominio`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `analisis` ADD CONSTRAINT `analisis_verificacion_id_fkey` FOREIGN KEY (`verificacion_id`) REFERENCES `verificaciones_dominio`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `resultados_comprobacion` ADD CONSTRAINT `resultados_comprobacion_analisis_id_fkey` FOREIGN KEY (`analisis_id`) REFERENCES `analisis`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

