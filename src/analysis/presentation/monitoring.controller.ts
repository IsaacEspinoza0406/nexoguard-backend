import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SessionGuard, AuthenticatedRequest } from '../../auth/presentation/session.guard';
import { CsrfGuard } from '../../security/csrf.guard';
import { MonitoringService } from '../application/monitoring.service';

export class ScheduleDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(10080) intervalMinutes?: number;
}

@ApiTags('Programación y alertas')
@Controller('sites/:siteId')
@UseGuards(SessionGuard, ThrottlerGuard)
@Throttle({ default: { limit: 60, ttl: 60000 } })
export class MonitoringController {
  constructor(private readonly service: MonitoringService) {}
  @Get('schedule')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Consultar programación propia y frecuencias aprobadas' })
  get(@Req() req: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string) { return this.service.get(req.user.id, site); }
  @Post('schedule')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Configurar, modificar o desactivar la programación del sitio propio' })
  configure(@Req() req: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string, @Body() dto: ScheduleDto) { return this.service.configure(req.user.id, site, dto.enabled, dto.intervalMinutes ?? 0); }
  @Get('alerts')
  @Header('Cache-Control', 'no-store')
  alerts(@Req() req: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string) { return this.service.alerts(req.user.id, site); }
  @Post('alerts/:id/read')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  read(@Req() req: AuthenticatedRequest, @Param('siteId', ParseUUIDPipe) site: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    if (body != null && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) throw new BadRequestException('Esta operación no acepta campos.');
    return this.service.read(req.user.id, site, id);
  }
}
