-- Additive provider coordination only: no existing rows/tables are changed.
CREATE TABLE `proveedores_externos` (
  `id` VARCHAR(32) NOT NULL,
  `siguiente_solicitud_en` DATETIME(3) NOT NULL,
  `reclamo_expira_en` DATETIME(3) NULL,
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `proveedores_externos` (`id`, `siguiente_solicitud_en`, `version`)
VALUES ('ssllabs-v4', CURRENT_TIMESTAMP(3), 0);
