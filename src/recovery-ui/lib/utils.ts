/**
 * Class name composition.
 *
 * The standard shadcn helper: `clsx` for conditional class lists and
 * `tailwind-merge` to let a caller's utility win over a component's default. The
 * merge step is the important half — without it, `<Button className="px-6">` would
 * emit both `px-3` and `px-6` and the winner would depend on stylesheet order
 * rather than intent.
 *
 * Same implementation as the reference (`native-ui/lib/utils.ts`).
 */
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
