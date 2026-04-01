import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    this.s3 = new S3Client({
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
    this.bucket = process.env.S3_BUCKET_NAME ?? 'suno-music-bucket';
  }

  /**
   * Upload a local file to the bucket.
   * Returns the S3 key (path within bucket).
   *
   * Key format: {email}/{requestId}_{filename}
   */
  async uploadFile(params: {
    localPath: string;
    email: string;
    requestId: string;
    filename: string;
    contentType?: string;
  }): Promise<string> {
    const { localPath, email, requestId, filename, contentType } = params;

    const sanitizedEmail = email.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${sanitizedEmail}/${requestId}_${filename}`;

    this.logger.log(`Uploading ${localPath} → s3://${this.bucket}/${key}`);

    const fileStream = fs.createReadStream(localPath);
    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType ?? 'audio/mpeg',
      },
    });

    await upload.done();
    this.logger.log(`Upload complete: s3://${this.bucket}/${key}`);

    return key;
  }

  /**
   * Upload raw buffer to the bucket.
   */
  async uploadBuffer(params: {
    buffer: Buffer;
    email: string;
    requestId: string;
    filename: string;
    contentType?: string;
  }): Promise<string> {
    const { buffer, email, requestId, filename, contentType } = params;

    const sanitizedEmail = email.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${sanitizedEmail}/${requestId}_${filename}`;

    this.logger.log(`Uploading buffer → s3://${this.bucket}/${key}`);

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType ?? 'audio/mpeg',
      }),
    );

    this.logger.log(`Upload complete: s3://${this.bucket}/${key}`);
    return key;
  }

  /**
   * Build a public-like URL for a key (useful for logging).
   * Adjust the pattern for your specific bucket/CDN setup.
   */
  getPublicUrl(key: string): string {
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      return `${endpoint}/${this.bucket}/${key}`;
    }
    return `https://${this.bucket}.s3.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;
  }
}
