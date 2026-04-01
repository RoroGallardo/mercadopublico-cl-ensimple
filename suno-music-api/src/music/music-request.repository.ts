import { Injectable } from '@nestjs/common';
import { MusicRequest } from './interfaces/music-request.interface';

/**
 * In-memory store for music requests.
 *
 * Replace with a proper persistence layer (TypeORM, Prisma, Redis, etc.)
 * for production use.
 */
@Injectable()
export class MusicRequestRepository {
  private readonly store = new Map<string, MusicRequest>();

  save(request: MusicRequest): void {
    request.updatedAt = new Date();
    this.store.set(request.requestId, { ...request });
  }

  findById(requestId: string): MusicRequest | undefined {
    return this.store.get(requestId);
  }

  findAll(): MusicRequest[] {
    return Array.from(this.store.values());
  }
}
