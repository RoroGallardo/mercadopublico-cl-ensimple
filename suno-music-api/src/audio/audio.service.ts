import { Injectable, Logger } from '@nestjs/common';
import * as ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import axios from 'axios';

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);
  private readonly tempDir: string;
  private readonly demoDuration: number;

  constructor() {
    this.tempDir = process.env.TEMP_DIR ?? '/tmp/suno-audio';
    this.demoDuration = parseInt(process.env.DEMO_DURATION_SECONDS ?? '15', 10);
    fs.mkdirSync(this.tempDir, { recursive: true });
  }

  /**
   * Download an audio file from a URL to a local temp path.
   * Returns the local file path.
   */
  async downloadAudio(url: string, filename: string): Promise<string> {
    const localPath = path.join(this.tempDir, filename);
    this.logger.log(`Downloading ${url} → ${localPath}`);

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    fs.writeFileSync(localPath, Buffer.from(response.data));

    this.logger.log(`Download complete: ${localPath}`);
    return localPath;
  }

  /**
   * Cut the first N seconds of an audio file to create a demo clip.
   * Returns path of the new demo file.
   */
  cutDemo(inputPath: string, outputFilename: string): Promise<string> {
    const outputPath = path.join(this.tempDir, outputFilename);
    this.logger.log(
      `Cutting ${this.demoDuration}s demo: ${inputPath} → ${outputPath}`,
    );

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(0)
        .setDuration(this.demoDuration)
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .output(outputPath)
        .on('end', () => {
          this.logger.log(`Demo cut complete: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Error cutting demo: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Strip AI metadata tags and re-encode for a clean final master.
   *
   * Strips all metadata, applies loudness normalisation (EBU R128) and
   * a gentle high-pass / limiter so the output sounds "DAW-processed".
   *
   * Returns path of the processed file.
   */
  processForFinalMaster(
    inputPath: string,
    outputFilename: string,
  ): Promise<string> {
    const outputPath = path.join(this.tempDir, outputFilename);
    this.logger.log(`Processing final master: ${inputPath} → ${outputPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        // Strip ALL metadata (removes AI generation tags)
        .outputOptions([
          '-map_metadata', '-1',
          '-map_chapters', '-1',
        ])
        // Audio filters: highpass, loudness normalisation, soft limiter
        .audioFilter([
          'highpass=f=40',
          'loudnorm=I=-16:TP=-1.5:LRA=11',
          'alimiter=level_in=1:level_out=1:limit=0.9:attack=5:release=50',
        ])
        .audioCodec('libmp3lame')
        .audioBitrate('320k')
        .audioChannels(2)
        .audioFrequency(44100)
        .output(outputPath)
        .on('end', () => {
          this.logger.log(`Final master ready: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err) => {
          this.logger.error(`Error processing master: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  /** Remove a temp file silently. */
  cleanup(filePath: string): void {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}
