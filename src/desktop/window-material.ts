/**
 * Translate a persisted window material into `BrowserWindow` options.
 *
 * KEEP THIS MODULE PURE AND ELECTRON-FREE. Nothing here imports `electron` or
 * touches a display, which is what makes the material path testable: the caller
 * (`window-registry.ts`) does nothing but spread `options` into the constructor
 * and forward `effective` to the renderer.
 *
 * WHY `backgroundColor` GOES TRANSPARENT
 * --------------------------------------
 * The system material is painted BEHIND the renderer, so an opaque renderer
 * background covers it completely. `window-registry.ts` normally sets an opaque
 * `backgroundColor` to stop the pre-paint frame flashing white — for a glass
 * material we therefore have to drop that colour and let the material provide the
 * backdrop. The renderer must then stop painting its own opaque background over
 * the same region, which is what the `data-window-material` rules in
 * `frontend/shell/styles/bar.css` do.
 *
 * WHY `effective` IS RETURNED SEPARATELY
 * --------------------------------------
 * The renderer's transparency and the window's material MUST agree. If the page
 * went transparent while no material was actually painted, the window would show
 * whatever is behind the page. So the caller forwards `effective` — the material
 * that is genuinely in force — and never the raw preference. On a platform where
 * nothing is painted, `effective` is `off` and the page stays opaque.
 *
 * WHAT IS DELIBERATELY NOT APPLIED
 * --------------------------------
 *  - `off` returns NO options rather than `backgroundMaterial: 'none'`. Omitting
 *    the option leaves Electron's own default untouched, so a profile that has
 *    never opened this setting produces window options byte-identical to a build
 *    without this feature. `off` is the default, so making it an explicit `none`
 *    would change every existing user's window on upgrade.
 *  - `transparent` is not implemented. A translucent window requires
 *    `transparent: true` at construction, which changes hit-testing and resize
 *    behaviour, cannot be combined with a system material, and cannot be verified
 *    without a display. It resolves to "no change" rather than half-applying.
 *
 * @module dsh-my-desktop/window-material
 */

import type { AppearanceMaterial } from '../profiles/appearance-preference.js'

/** The subset of `BrowserWindowConstructorOptions` this feature may set. */
export interface WindowMaterialOptions {
  readonly backgroundMaterial?: 'mica' | 'acrylic'
  readonly backgroundColor?: string
}

/** Material that is actually in force, and what the renderer must match. */
export interface WindowMaterialApplication {
  /** Window options to spread into the `BrowserWindow` constructor. */
  readonly options: WindowMaterialOptions
  /** Material genuinely applied; `off` whenever nothing is painted. */
  readonly effective: AppearanceMaterial
}

/** Fully transparent: lets the system material through instead of covering it. */
const TRANSPARENT_BACKGROUND = '#00000000'

/**
 * Resolve a material into window options plus the material actually in force.
 *
 * The system material API is documented `@platform win32` and is only honoured
 * from Windows 11 22H2 onward. On every other platform — and on older Windows,
 * where Electron silently ignores the option — this resolves to "no change" so
 * the same profile still launches, just without the effect.
 */
export function resolveWindowMaterial(
  material: AppearanceMaterial,
  platform: NodeJS.Platform,
): WindowMaterialApplication {
  if (platform === 'win32' && (material === 'mica' || material === 'acrylic')) {
    return {
      options: { backgroundMaterial: material, backgroundColor: TRANSPARENT_BACKGROUND },
      effective: material,
    }
  }
  return { options: {}, effective: 'off' }
}
