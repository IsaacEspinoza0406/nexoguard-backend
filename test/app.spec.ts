import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

describe('Aplicación inicial', () => {
  it('se inicializa sin base de datos', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({}).compile();
    const app = module.createNestApplication();
    await app.init();
    expect(app).toBeDefined();
    await app.close();
  });
});
