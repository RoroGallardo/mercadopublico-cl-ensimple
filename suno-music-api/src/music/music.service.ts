import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { SunoService } from '../suno/suno.service';
import { StorageService } from '../storage/storage.service';
import { AudioService } from '../audio/audio.service';
import { MusicRequestRepository } from './music-request.repository';
import { GenerateMusicDto } from './dto/generate-music.dto';
import { ConfirmDemoDto } from './dto/confirm-demo.dto';
import {
  MusicRequest,
  MusicRequestStatus,
  SongAsset,
} from './interfaces/music-request.interface';

@Injectable()
export class MusicService {
  private readonly logger = new Logger(MusicService.name);

  constructor(
    private readonly sunoService: SunoService,
    private readonly storageService: StorageService,
    private readonly audioService: AudioService,
    private readonly repository: MusicRequestRepository,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // 1. GENERATE
  // ─────────────────────────────────────────────────────────────────

  /**
   * Kick off the full generation pipeline asynchronously and return
   * the requestId immediately so the caller can track progress.
   */
  async initiateGeneration(dto: GenerateMusicDto): Promise<{ requestId: string }> {
    const requestId = uuidv4();
    const now = new Date();

    const request: MusicRequest = {
      requestId,
      requesterEmail: dto.requesterEmail,
      status: 'GENERATING',
      createdAt: now,
      updatedAt: now,
      sunoClipIds: [],
      songs: [],
    };

    this.repository.save(request);
    this.logger.log(`[${requestId}] Generation initiated for ${dto.requesterEmail}`);

    // Run the pipeline in the background (fire-and-forget)
    this.runGenerationPipeline(requestId, dto).catch((err) => {
      this.logger.error(`[${requestId}] Pipeline failed: ${err.message}`, err.stack);
      const req = this.repository.findById(requestId);
      if (req) {
        req.status = 'FAILED';
        req.error = err.message;
        this.repository.save(req);
      }
    });

    return { requestId };
  }

  private async runGenerationPipeline(
    requestId: string,
    dto: GenerateMusicDto,
  ): Promise<void> {
    const req = this.repository.findById(requestId)!;

    // ── Step 1: Submit to Suno ─────────────────────────────────────
    const clipIds = await this.sunoService.generate({
      gpt_description_prompt: dto.gpt_description_prompt,
      prompt: dto.prompt,
      tags: dto.tags,
      title: dto.title,
      make_instrumental: dto.make_instrumental,
    });

    req.sunoClipIds = clipIds;
    this.repository.save(req);

    // ── Step 2: Poll until complete ────────────────────────────────
    this.logger.log(`[${requestId}] Waiting for Suno to complete generation…`);
    const completedSongs = await this.sunoService.waitForCompletion(clipIds);

    if (!completedSongs.length) {
      throw new Error('Suno returned no completed songs');
    }

    req.songs = completedSongs.map((s) => ({
      sunoClipId: s.id,
      title: s.title || `song-${s.id}`,
      originalUrl: s.audio_url,
    }));

    req.status = 'DOWNLOADING';
    this.repository.save(req);

    // ── Step 3: Download + upload full songs to bucket ─────────────
    this.logger.log(`[${requestId}] Downloading ${req.songs.length} song(s)…`);

    for (let i = 0; i < req.songs.length; i++) {
      const song = req.songs[i];
      const filename = this.sanitizeFilename(`${song.title}.mp3`);

      const localPath = await this.audioService.downloadAudio(
        song.originalUrl,
        `${requestId}_${i}_${filename}`,
      );
      song.localPath = localPath;

      const bucketKey = await this.storageService.uploadFile({
        localPath,
        email: req.requesterEmail,
        requestId,
        filename,
        contentType: 'audio/mpeg',
      });
      song.bucketKey = bucketKey;

      this.logger.log(`[${requestId}] Song ${i + 1} uploaded → ${bucketKey}`);
    }

    // ── Step 4: Create demos ───────────────────────────────────────
    req.status = 'CREATING_DEMOS';
    this.repository.save(req);
    this.logger.log(`[${requestId}] Creating 15s demo clips…`);

    for (let i = 0; i < req.songs.length; i++) {
      const song = req.songs[i];
      const demoFilename = this.sanitizeFilename(`demo_${song.title}.mp3`);

      const demoLocalPath = await this.audioService.cutDemo(
        song.localPath!,
        `${requestId}_${i}_${demoFilename}`,
      );
      song.demoLocalPath = demoLocalPath;

      const demoBucketKey = await this.storageService.uploadFile({
        localPath: demoLocalPath,
        email: req.requesterEmail,
        requestId,
        filename: demoFilename,
        contentType: 'audio/mpeg',
      });
      song.demoBucketKey = demoBucketKey;

      this.logger.log(`[${requestId}] Demo ${i + 1} uploaded → ${demoBucketKey}`);
    }

    // ── Step 5: Present demo 1 ─────────────────────────────────────
    req.status = 'AWAITING_DEMO_1';
    this.repository.save(req);

    this.logger.log(
      `[${requestId}] Ready. Demo 1 URL: ${this.storageService.getPublicUrl(req.songs[0].demoBucketKey!)}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. STATUS
  // ─────────────────────────────────────────────────────────────────

  getStatus(requestId: string): MusicRequest {
    const req = this.repository.findById(requestId);
    if (!req) throw new NotFoundException(`Request ${requestId} not found`);
    return req;
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. DEMO CONFIRMATION FLOW
  // ─────────────────────────────────────────────────────────────────

  /**
   * Statuses that are part of the demo approval flow:
   *
   *   AWAITING_DEMO_1  → accept → PROCESSING_FINAL (song 0)
   *                   → reject → AWAITING_DEMO_2
   *
   *   AWAITING_DEMO_2  → accept → PROCESSING_FINAL (song 1)
   *                   → reject → AWAITING_SELECTION
   *
   *   AWAITING_SELECTION → select (1|2) → PROCESSING_FINAL (song 0|1)
   */
  async confirmDemo(dto: ConfirmDemoDto): Promise<MusicRequest> {
    const req = this.repository.findById(dto.requestId);
    if (!req) throw new NotFoundException(`Request ${dto.requestId} not found`);

    const { action, selectedDemo } = dto;

    switch (req.status) {
      // ── Demo 1 presented ──────────────────────────────────────────
      case 'AWAITING_DEMO_1': {
        if (action === 'accept') {
          this.logger.log(`[${req.requestId}] Demo 1 accepted`);
          req.acceptedDemoIndex = 0;
          await this.processFinal(req);
        } else if (action === 'reject') {
          this.logger.log(`[${req.requestId}] Demo 1 rejected → presenting demo 2`);
          req.status = 'AWAITING_DEMO_2';
          this.repository.save(req);

          if (req.songs[1]?.demoBucketKey) {
            this.logger.log(
              `[${req.requestId}] Demo 2 URL: ${this.storageService.getPublicUrl(req.songs[1].demoBucketKey)}`,
            );
          }
        } else {
          throw new BadRequestException(
            `Action '${action}' is not valid for status AWAITING_DEMO_1. Use 'accept' or 'reject'.`,
          );
        }
        break;
      }

      // ── Demo 2 presented ──────────────────────────────────────────
      case 'AWAITING_DEMO_2': {
        if (action === 'accept') {
          this.logger.log(`[${req.requestId}] Demo 2 accepted`);
          req.acceptedDemoIndex = 1;
          await this.processFinal(req);
        } else if (action === 'reject') {
          this.logger.log(
            `[${req.requestId}] Demo 2 also rejected → entering selection mode`,
          );
          req.status = 'AWAITING_SELECTION';
          this.repository.save(req);

          const d1 = this.storageService.getPublicUrl(req.songs[0].demoBucketKey!);
          const d2 = this.storageService.getPublicUrl(req.songs[1].demoBucketKey!);
          this.logger.log(
            `[${req.requestId}] Both demos rejected. User must choose.\n  Demo 1: ${d1}\n  Demo 2: ${d2}`,
          );
        } else {
          throw new BadRequestException(
            `Action '${action}' is not valid for status AWAITING_DEMO_2. Use 'accept' or 'reject'.`,
          );
        }
        break;
      }

      // ── Both rejected – user must choose ─────────────────────────
      case 'AWAITING_SELECTION': {
        if (action !== 'select') {
          throw new BadRequestException(
            `Both demos were rejected. Use action 'select' with selectedDemo: 1 or 2.`,
          );
        }
        if (!selectedDemo || (selectedDemo !== 1 && selectedDemo !== 2)) {
          throw new BadRequestException(
            `selectedDemo must be 1 or 2 when action is 'select'.`,
          );
        }
        const demoIndex = selectedDemo - 1; // convert to 0-based
        this.logger.log(
          `[${req.requestId}] User selected demo ${selectedDemo} (index ${demoIndex})`,
        );
        req.acceptedDemoIndex = demoIndex;
        await this.processFinal(req);
        break;
      }

      default:
        throw new BadRequestException(
          `Cannot confirm demo: request is in status '${req.status}'.`,
        );
    }

    return this.repository.findById(dto.requestId)!;
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. FINAL PROCESSING
  // ─────────────────────────────────────────────────────────────────

  private async processFinal(req: MusicRequest): Promise<void> {
    req.status = 'PROCESSING_FINAL';
    this.repository.save(req);

    const song = req.songs[req.acceptedDemoIndex!];
    this.logger.log(
      `[${req.requestId}] Processing final master for: "${song.title}" (index ${req.acceptedDemoIndex})`,
    );

    const finalFilename = this.sanitizeFilename(`final_${song.title}.mp3`);

    // Strip AI metadata + re-encode
    const finalLocalPath = await this.audioService.processForFinalMaster(
      song.localPath!,
      `${req.requestId}_${finalFilename}`,
    );

    // Upload final to bucket
    const finalBucketKey = await this.storageService.uploadFile({
      localPath: finalLocalPath,
      email: req.requesterEmail,
      requestId: req.requestId,
      filename: finalFilename,
      contentType: 'audio/mpeg',
    });

    song.finalBucketKey = finalBucketKey;

    // Cleanup temp files
    this.audioService.cleanup(finalLocalPath);
    req.songs.forEach((s) => {
      if (s.localPath) this.audioService.cleanup(s.localPath);
      if (s.demoLocalPath) this.audioService.cleanup(s.demoLocalPath);
    });

    req.status = 'COMPLETED';
    this.repository.save(req);

    const finalUrl = this.storageService.getPublicUrl(finalBucketKey);

    // TODO: Replace with real notification (email, webhook, push, etc.)
    this.logger.log(
      `[${req.requestId}] ✅ FINAL READY — Notification URL: ${finalUrl}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }
}
