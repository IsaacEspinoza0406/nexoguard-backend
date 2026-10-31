import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../../generated/prisma/client';

function localDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  try {
    if (!value || process.env.NEXOGUARD_DB_MODE !== 'local_unencrypted') throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'mysql:' || url.hostname !== 'db' || url.port !== '3306' ||
        url.pathname !== '/nexoguard_migration_test' || decodeURIComponent(url.username) !== 'nexoguard' ||
        !url.password || decodeURIComponent(url.password).includes('REEMPLAZAR') || url.search || url.hash) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error('Configuración de base de datos inválida: se requiere el destino Docker local autorizado.');
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaMariaDb(localDatabaseUrl()) });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
    } catch {
      await this.$disconnect();
      throw new Error('No se pudo conectar a la base de datos local.');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
