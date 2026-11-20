import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Equals, IsBoolean } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedRequest, SessionGuard } from '../../auth/presentation/session.guard';
import { CsrfGuard } from '../../security/csrf.guard';
import { SslLabsService } from '../application/ssl-labs.service';

export class SslLabsConsentDto { @IsBoolean() @Equals(true) consent!: boolean; }
@ApiTags('SSL Labs complementario')
@Controller('sites/:siteId/ssl-labs')
@UseGuards(SessionGuard, ThrottlerGuard)
export class SslLabsController {
  constructor(private readonly service: SslLabsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  history(@Req() req: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string) { return this.service.history(req.user.id, site); }
  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @ApiOperation({ summary: 'Autorizar una consulta SSL Labs de la revisión verificada, con caché de hasta 24 horas' })
  start(@Req() req: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string, @Body() dto: SslLabsConsentDto) { return this.service.start(req.user.id, site, dto.consent); }
}
