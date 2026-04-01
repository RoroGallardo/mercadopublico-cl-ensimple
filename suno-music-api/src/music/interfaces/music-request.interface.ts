export type MusicRequestStatus =
  | 'GENERATING'        // submitted to Suno, waiting
  | 'DOWNLOADING'       // songs complete, downloading audio
  | 'CREATING_DEMOS'    // cutting demo clips
  | 'AWAITING_DEMO_1'   // demo 1 presented, waiting for approval
  | 'AWAITING_DEMO_2'   // demo 1 rejected, demo 2 presented
  | 'AWAITING_SELECTION'// both rejected, user must choose 1 or 2
  | 'PROCESSING_FINAL'  // accepted demo being mastered
  | 'COMPLETED'         // final uploaded, URL logged
  | 'FAILED';           // unrecoverable error

export interface SongAsset {
  sunoClipId: string;
  title: string;
  originalUrl: string;       // Suno CDN URL
  localPath?: string;         // temp local path after download
  bucketKey?: string;         // path in S3 bucket (full song)
  demoLocalPath?: string;     // temp local path of 15s demo
  demoBucketKey?: string;     // path in S3 bucket (demo)
  finalBucketKey?: string;    // path in S3 bucket (final master)
}

export interface MusicRequest {
  requestId: string;
  requesterEmail: string;
  status: MusicRequestStatus;
  createdAt: Date;
  updatedAt: Date;

  sunoClipIds: string[];
  songs: SongAsset[];          // populated after Suno completes

  /** Which demo (index 0 or 1) was accepted and is being mastered */
  acceptedDemoIndex?: number;

  error?: string;
}
