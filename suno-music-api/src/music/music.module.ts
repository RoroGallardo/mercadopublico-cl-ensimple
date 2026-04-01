import { Module } from '@nestjs/common';
import { MusicController } from './music.controller';
import { MusicService } from './music.service';
import { MusicRequestRepository } from './music-request.repository';
import { SunoModule } from '../suno/suno.module';
import { StorageModule } from '../storage/storage.module';
import { AudioModule } from '../audio/audio.module';

@Module({
  imports: [SunoModule, StorageModule, AudioModule],
  controllers: [MusicController],
  providers: [MusicService, MusicRequestRepository],
})
export class MusicModule {}
