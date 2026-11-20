import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, PipeTransform, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedRequest, SessionGuard } from '../../auth/presentation/session.guard';
import { CsrfGuard } from '../../security/csrf.guard';
import { SitesService } from '../application/sites.service';

export class CreateSiteDto {
  @IsString()
  @MaxLength(1024)
  domain!: string;
}

class EmptyBodyPipe implements PipeTransform {
  transform(value: unknown) {
    if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0)) throw new BadRequestException('Esta operación no acepta campos.');
    return value;
  }
}

@Controller('sites')
@UseGuards(SessionGuard, ThrottlerGuard)
export class SitesController {
  constructor(private readonly sites: SitesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  list(@Req() request: AuthenticatedRequest) { return this.sites.list(request.user.id); }

  @Post()
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  create(@Req() request: AuthenticatedRequest, @Body() body: CreateSiteDto) { return this.sites.create(request.user.id, body.domain); }

  @Post(':id/verification-challenges')
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  issue(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body(new EmptyBodyPipe()) body: unknown) { void body; return this.sites.issue(request.user.id, id); }

  @Post(':id/verification-challenges/:challengeId/check')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  check(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Param('challengeId', ParseUUIDPipe) challengeId: string, @Body(new EmptyBodyPipe()) body: unknown) { void body; return this.sites.verify(request.user.id, id, challengeId); }
}
