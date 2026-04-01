import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MusicService } from './music.service';
import { GenerateMusicDto } from './dto/generate-music.dto';
import { ConfirmDemoDto } from './dto/confirm-demo.dto';

@Controller('music')
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  /**
   * POST /music/generate
   *
   * Accepts the generation parameters and kicks off the async pipeline.
   * Returns immediately with a requestId for tracking.
   *
   * Body: GenerateMusicDto
   */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(@Body() dto: GenerateMusicDto) {
    const result = await this.musicService.initiateGeneration(dto);
    return {
      message: 'Generation pipeline started. Poll /music/status/:requestId for progress.',
      ...result,
    };
  }

  /**
   * GET /music/status/:requestId
   *
   * Returns the current state of a music request including:
   * - status
   * - demo bucket keys / URLs (when available)
   * - final bucket key / URL (when completed)
   */
  @Get('status/:requestId')
  getStatus(@Param('requestId') requestId: string) {
    const req = this.musicService.getStatus(requestId);
    return {
      requestId: req.requestId,
      status: req.status,
      requesterEmail: req.requesterEmail,
      createdAt: req.createdAt,
      updatedAt: req.updatedAt,
      songs: req.songs.map((s) => ({
        title: s.title,
        bucketKey: s.bucketKey,
        demoBucketKey: s.demoBucketKey,
        finalBucketKey: s.finalBucketKey,
      })),
      acceptedDemoIndex: req.acceptedDemoIndex,
      error: req.error,
    };
  }

  /**
   * POST /music/confirm-demo
   *
   * Drive the demo approval state machine.
   *
   * Flow:
   *   1. status = AWAITING_DEMO_1  → action: 'accept' | 'reject'
   *   2. status = AWAITING_DEMO_2  → action: 'accept' | 'reject'
   *   3. status = AWAITING_SELECTION (both rejected)
   *              → action: 'select', selectedDemo: 1 | 2
   *
   * Accepting triggers metadata cleanup + DAW processing and
   * uploads the final master to the bucket.
   */
  @Post('confirm-demo')
  @HttpCode(HttpStatus.OK)
  async confirmDemo(@Body() dto: ConfirmDemoDto) {
    const updated = await this.musicService.confirmDemo(dto);
    return {
      requestId: updated.requestId,
      status: updated.status,
      acceptedDemoIndex: updated.acceptedDemoIndex,
      finalBucketKey: updated.songs[updated.acceptedDemoIndex ?? 0]?.finalBucketKey,
      message: this.statusMessage(updated.status),
    };
  }

  private statusMessage(status: string): string {
    const messages: Record<string, string> = {
      AWAITING_DEMO_2: 'Demo 1 rejected. Demo 2 is now available for review.',
      AWAITING_SELECTION:
        'Both demos rejected. Use action "select" with selectedDemo: 1 or 2 to choose one.',
      PROCESSING_FINAL:
        'Demo accepted. Processing final master (metadata cleanup + mastering)…',
      COMPLETED: 'Final master is ready. URL has been logged.',
    };
    return messages[status] ?? status;
  }
}
