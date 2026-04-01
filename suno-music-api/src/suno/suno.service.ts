import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { SunoGenerateResponse, SunoSong } from './interfaces/suno-task.interface';

export interface SunoGenerateParams {
  gpt_description_prompt?: string;
  prompt?: string;
  tags?: string;
  title?: string;
  make_instrumental?: boolean;
  mv?: string;
}

@Injectable()
export class SunoService {
  private readonly logger = new Logger(SunoService.name);
  private readonly client: AxiosInstance;

  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;

  constructor() {
    const baseURL = process.env.SUNO_API_BASE_URL ?? 'https://api.sunoaiapi.com';
    const apiKey = process.env.SUNO_API_KEY ?? '';

    this.client = axios.create({
      baseURL,
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    this.pollIntervalMs = parseInt(process.env.SUNO_POLL_INTERVAL_MS ?? '5000', 10);
    this.pollMaxAttempts = parseInt(process.env.SUNO_POLL_MAX_ATTEMPTS ?? '60', 10);
  }

  /**
   * Submit a generation request to Suno and return the clip IDs immediately.
   * Suno always generates 2 songs per request.
   */
  async generate(params: SunoGenerateParams): Promise<string[]> {
    this.logger.log(`Submitting generation request: ${JSON.stringify(params)}`);

    const response = await this.client.post<SunoGenerateResponse>('/api/v1/generate', {
      ...params,
      mv: params.mv ?? 'chirp-v3-5',
    });

    const clips = response.data?.clips ?? (response.data as any);
    const ids: string[] = Array.isArray(clips)
      ? clips.map((c: any) => c.id ?? c)
      : Object.values(clips).map((c: any) => c.id ?? c);

    this.logger.log(`Generation submitted. Clip IDs: ${ids.join(', ')}`);
    return ids;
  }

  /**
   * Fetch the current status of one or more clip IDs.
   */
  async getClips(ids: string[]): Promise<SunoSong[]> {
    const response = await this.client.get<SunoSong[]>('/api/v1/get', {
      params: { ids: ids.join(',') },
    });

    // Some API wrappers return { data: [...] }, normalise both shapes
    const songs: SunoSong[] = Array.isArray(response.data)
      ? response.data
      : (response.data as any).data ?? [];

    return songs;
  }

  /**
   * Poll until all clips reach 'complete' or 'error' status.
   * Resolves with the completed SunoSong array.
   */
  async waitForCompletion(ids: string[]): Promise<SunoSong[]> {
    this.logger.log(`Polling for completion of clips: ${ids.join(', ')}`);

    for (let attempt = 0; attempt < this.pollMaxAttempts; attempt++) {
      await this.sleep(this.pollIntervalMs);

      const songs = await this.getClips(ids);
      const statuses = songs.map((s) => s.status);

      this.logger.debug(
        `Poll attempt ${attempt + 1}/${this.pollMaxAttempts} – statuses: ${statuses.join(', ')}`,
      );

      const allDone = statuses.every((s) => s === 'complete' || s === 'error');
      if (allDone) {
        const failed = songs.filter((s) => s.status === 'error');
        if (failed.length) {
          this.logger.warn(`${failed.length} clip(s) finished with error status`);
        }
        return songs.filter((s) => s.status === 'complete');
      }
    }

    throw new Error(
      `Suno generation timed out after ${this.pollMaxAttempts * this.pollIntervalMs / 1000}s`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
