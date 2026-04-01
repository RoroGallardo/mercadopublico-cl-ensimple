export type SunoSongStatus =
  | 'submitted'
  | 'queued'
  | 'streaming'
  | 'complete'
  | 'error';

export interface SunoSong {
  id: string;
  title: string;
  image_url: string;
  lyric: string;
  audio_url: string;
  video_url: string;
  created_at: string;
  model_name: string;
  status: SunoSongStatus;
  gpt_description_prompt: string;
  prompt: string;
  type: string;
  tags: string;
}

export interface SunoGenerateResponse {
  /** Array of song clip IDs returned immediately after submission */
  clips: Array<{ id: string; status: SunoSongStatus }>;
}
