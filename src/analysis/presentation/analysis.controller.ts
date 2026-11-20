import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SessionGuard, AuthenticatedRequest } from '../../auth/presentation/session.guard';
import { CsrfGuard } from '../../security/csrf.guard';
import { AnalysisService } from '../application/analysis.service';

@ApiTags('Análisis manual')
@Controller('sites/:siteId/analyses')
@UseGuards(SessionGuard, ThrottlerGuard)
export class AnalysisController {
  constructor(private readonly service: AnalysisService) {}
  @Post()
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Iniciar un análisis manual de la revisión verificada actual' })
  start(@Req() request: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string, @Body() body: unknown) {
    if (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('Esta operación no acepta campos.');
    return this.service.start(request.user.id, site);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  history(@Req() request: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string) { return this.service.history(request.user.id, site); }
  @Get('compare/:before/:after')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'Comparar dos análisis propios de la misma revisión, en orden cronológico' })
  compare(@Req() request: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string, @Param('before', ParseUUIDPipe) before: string, @Param('after', ParseUUIDPipe) after: string) { return this.service.compare(request.user.id, site, before, after); }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  detail(@Req() request: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(request.user.id, site, id); }
}
