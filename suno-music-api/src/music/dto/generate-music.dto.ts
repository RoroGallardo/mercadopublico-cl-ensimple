import {
  IsEmail,
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateMusicDto {
  /**
   * Free-text description sent to Suno's GPT prompt engine.
   * Example: "an upbeat pop song about summer adventures"
   */
  @IsString()
  @MinLength(5)
  @MaxLength(400)
  gpt_description_prompt: string;

  /**
   * Optional: explicit lyrics / metatags for custom mode.
   * Leave blank to let Suno generate lyrics automatically.
   */
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  prompt?: string;

  /**
   * Music style tags (e.g. "pop, upbeat, electric guitar").
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  tags?: string;

  /**
   * Desired song title.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  /**
   * Generate an instrumental track (no vocals).
   */
  @IsOptional()
  @IsBoolean()
  make_instrumental?: boolean;

  /**
   * Email of the person requesting the song.
   * Used to organise bucket storage.
   */
  @IsEmail()
  requesterEmail: string;
}
