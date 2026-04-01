import { IsString, IsIn, IsOptional, IsInt, Min, Max } from 'class-validator';

/**
 * Actions:
 *  - 'accept'  → accept the demo currently being presented.
 *  - 'reject'  → reject the demo currently being presented.
 *  - 'select'  → used only when both demos have been rejected.
 *                Must be combined with `selectedDemo` (1 or 2).
 */
export type DemoAction = 'accept' | 'reject' | 'select';

export class ConfirmDemoDto {
  @IsString()
  requestId: string;

  @IsIn(['accept', 'reject', 'select'])
  action: DemoAction;

  /**
   * Required when action === 'select'.
   * 1 → choose demo 1, 2 → choose demo 2.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  selectedDemo?: 1 | 2;
}
