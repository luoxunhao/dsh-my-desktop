/**
 * Strict same-origin HTTP handlers for the dsh-my-desktop-setting API.
 *
 * The browser client is served by the same DSH web server that hosts these
 * routes, so requests are authorized by a same-origin check (Origin/referer +
 * `sec-fetch-site`), not by assuming a loopback socket (the profile may be
 * reachable on LAN). Every method mismatch, body parse failure, and handler
 * rejection becomes an explicit 4xx/5xx — never an unhandled rejection.
 *
 * Host-专属 endpoints first consult the capability manifest; when the running
 * DSH profile cannot honor them they answer HTTP 501 with a stable
 * `capability:false`-style error code so the client degrades cleanly.
 *
 * @module dsh-my-desktop-setting/http-handlers
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  SettingsCapabilityToken,
  SettingsErrorResponse,
} from './contract.js'
import { findCapability } from './host-capability.js'
import {
  parseAaSelect,
  parseAppearanceUpdate,
  parseMarketSelect,
  parseNotificationsUpdate,
  type DesktopSettingsController,
} from './host-controller.js'
import type { HostActionResult } from './host-controller.js'

const MAX_BODY_BYTES = 16 * 1024

class BodyTooLargeError extends Error {}

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** Origin implied by the request's Host header (`scheme://host[:port]`), if well-formed. */
function requestHostOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host
  if (typeof host !== 'string' || host.length === 0) return null
  // Proxy-forwarded `Host` may include a port; both sides are compared through
  // the same URL normalization below, so casing and default ports never decide.
  return normalizeOrigin(`http://${host}`)
}

/**
 * Canonical origin (`scheme://host[:port]`) of an Origin/referer header, or null
 * when the value is absent or unparsable. The path, query, and hash of a URL are
 * deliberately ignored: browsers always attach a full page URL (with a path) in
 * the `Referer`, and only the scheme/host/port carry the same-origin decision.
 */
function normalizeOrigin(value: string | undefined): string | null {
  if (value === undefined || value.length === 0) return null
  try {
    const url = new URL(value)
    return url.origin
  } catch {
    return null
  }
}

/**
 * Browser same-origin authorization, mirroring the DSH connection fence
 * (`client-connection` `isTrustedApiRequest`): the request is bound to this
 * server's `Host`, and any explicit browser marker that labels it cross-site is
 * refused.
 *
 * - Mutating writes carry an `Origin` header on every browser request; those
 *   require an exact same-origin `Origin` (the CSRF defense).
 * - Reads (GETs) do not send `Origin` and, depending on the page's referrer
 *   policy, may or may not send a usable `Referer`. A cross-site GET cannot
 *   read this JSON response (same-origin policy), so a read is authorized when
 *   it is not cross-site: an `Origin`/`Referer`, when present, must match our
 *   `Host`; when both are absent the browser's `sec-fetch-site` is enough to
 *   tell a same-origin fetch from a cross-site one.
 */
function isSameOrigin(req: IncomingMessage, mutating: boolean): boolean {
  const hostOrigin = requestHostOrigin(req)
  if (hostOrigin === null) return false
  const site = req.headers['sec-fetch-site']
  if (site === 'cross-site') return false
  const origin = normalizeOrigin(req.headers.origin)
  if (origin !== null) {
    if (origin !== hostOrigin) return false
    // A same-origin Origin is decisive; do not also demand a matching site.
    return true
  }
  if (mutating) {
    // Writes without a same-origin Origin are refused (strict CSRF posture),
    // even though some embedders omit it — never mutate cross-context.
    return false
  }
  // Read fallback: an explicit same-origin referer authorizes; otherwise the
  // page must be the profile's own (not an opaque/file or rebound origin).
  const referer = normalizeOrigin(req.headers.referer)
  if (referer !== null) return referer === hostOrigin
  return site === undefined || site === 'same-origin' || site === 'same-site'
}

function isJson(req: IncomingMessage): boolean {
  return req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const declared = req.headers['content-length']
  if (declared !== undefined) {
    if (!/^\d+$/.test(declared)) throw new SyntaxError('invalid content length')
    if (Number(declared) > MAX_BODY_BYTES) throw new BodyTooLargeError()
  }
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 0
}

function finishJson(
  res: ServerResponse,
  status: number,
  body: object,
  allow?: string,
): void {
  res.statusCode = status
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('x-content-type-options', 'nosniff')
  if (allow !== undefined) res.setHeader('allow', allow)
  res.end(JSON.stringify(body))
}

function error(
  message: string,
  code: string,
  capability: SettingsCapabilityToken | null = null,
): SettingsErrorResponse {
  return { error: message, code, capability }
}

async function parsePostBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | typeof INVALID_BODY> {
  if (!isJson(req)) {
    finishJson(res, 415, error('content type must be application/json', 'bad.media-type'))
    return INVALID_BODY
  }
  try {
    return await readJson(req)
  } catch (cause) {
    const tooLarge = cause instanceof BodyTooLargeError
    finishJson(
      res,
      tooLarge ? 413 : 400,
      error(
        tooLarge ? 'request body is too large' : 'invalid JSON request',
        tooLarge ? 'bad.too-large' : 'bad.json',
      ),
    )
    return INVALID_BODY
  }
}

const INVALID_BODY = Symbol('invalid body')

/** Shared guard for every endpoint: method + same-origin. */
function guard(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (req.method !== method) {
    finishJson(res, 405, error('method not allowed', 'bad.method'), method)
    return false
  }
  if (!isSameOrigin(req, method === 'POST')) {
    finishJson(res, 403, error('forbidden', 'forbidden'))
    return false
  }
  return true
}

interface HandlerContext {
  readonly controller: DesktopSettingsController
  reportError(operation: string, cause: unknown): void
}

/** GET the full renderer-safe projection. */
export function handleState(ctx: HandlerContext): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'GET')) return
    try {
      finishJson(res, 200, ctx.controller.read())
    } catch (cause) {
      ctx.reportError('read settings', cause)
      finishJson(res, 500, error('settings unavailable', 'internal'))
    }
  }
}

/** POST persist a plugin-market provider preference. */
export function handleMarketSelect(ctx: HandlerContext): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const value = await parsePostBody(req, res)
    if (value === INVALID_BODY) return
    const request = parseMarketSelect(value)
    if (request === null) return finishJson(res, 400, error('invalid market selection', 'bad.market'))
    try {
      if (!ctx.controller.persistenceAvailable) {
        return finishJson(res, 501, error('settings persistence is unavailable in this environment', 'persist.unavailable'))
      }
      const acceptance = await ctx.controller.selectMarket(request)
      finishJson(res, 200, acceptance)
    } catch (cause) {
      ctx.reportError('select market provider', cause)
      finishJson(res, 500, error('market selection could not be saved', 'internal'))
    }
  }
}

/** POST persist the AA preference. */
export function handleAaSelect(ctx: HandlerContext): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const value = await parsePostBody(req, res)
    if (value === INVALID_BODY) return
    const request = parseAaSelect(value)
    if (request === null) return finishJson(res, 400, error('invalid AA selection', 'bad.aa'))
    try {
      if (!ctx.controller.persistenceAvailable) {
        return finishJson(res, 501, error('settings persistence is unavailable in this environment', 'persist.unavailable'))
      }
      const acceptance = await ctx.controller.selectAa(request)
      finishJson(res, 200, acceptance)
    } catch (cause) {
      ctx.reportError('select AA', cause)
      finishJson(res, 500, error('AA selection could not be saved', 'internal'))
    }
  }
}

/** POST persist the notifications preference. */
export function handleNotificationsUpdate(ctx: HandlerContext): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const value = await parsePostBody(req, res)
    if (value === INVALID_BODY) return
    const request = parseNotificationsUpdate(value)
    if (request === null) {
      return finishJson(res, 400, error('invalid notifications update', 'bad.notifications'))
    }
    try {
      if (!ctx.controller.persistenceAvailable) {
        return finishJson(res, 501, error('settings persistence is unavailable in this environment', 'persist.unavailable'))
      }
      finishJson(res, 200, await ctx.controller.updateNotifications(request))
    } catch (cause) {
      ctx.reportError('update notifications', cause)
      finishJson(res, 500, error('notifications could not be saved', 'internal'))
    }
  }
}

/** POST persist an appearance preference. */
export function handleAppearanceUpdate(ctx: HandlerContext): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const value = await parsePostBody(req, res)
    if (value === INVALID_BODY) return
    const request = parseAppearanceUpdate(value)
    if (request === null) {
      return finishJson(res, 400, error('invalid appearance update', 'bad.appearance'))
    }
    try {
      if (!ctx.controller.persistenceAvailable) {
        return finishJson(res, 501, error('settings persistence is unavailable in this environment', 'persist.unavailable'))
      }
      finishJson(res, 200, await ctx.controller.updateAppearance(request))
    } catch (cause) {
      ctx.reportError('update appearance', cause)
      finishJson(res, 500, error('appearance could not be saved', 'internal'))
    }
  }
}

/**
 * Serve one Host-专属 action endpoint. `token` drives both the capability check
 * (501 when unsupported) and the controller forwarding.
 */
export function handleHostAction(
  ctx: HandlerContext,
  token: SettingsCapabilityToken,
): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const value = await parsePostBody(req, res)
    if (value === INVALID_BODY) return
    if (!isEmptyObject(value)) {
      return finishJson(res, 400, error('invalid action request', 'bad.action'))
    }
    const capability = findCapability(ctx.controller.capabilities(), token)
    if (capability === undefined || !capability.supported) {
      const code = capability?.unsupportedCode ?? 'host.unsupported'
      return finishJson(res, 501, error(capability?.reason ?? 'current host does not support this operation', code, token))
    }
    let result: HostActionResult
    try {
      result = await ctx.controller.performHostAction(token)
    } catch (cause) {
      ctx.reportError(`host action ${token}`, cause)
      finishJson(res, 500, error('host action failed', 'internal', token))
      return
    }
    if (result.ok) {
      finishJson(res, 200, result.acceptance)
      return
    }
    finishJson(res, 501, error('current host could not complete this operation', result.code, token))
  }
}

/** Validate a profile `{ name }` body; null when malformed. */
function parseProfileRequest(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 1) return null
  if (typeof record.name !== 'string' || record.name.length === 0) return null
  return record.name
}

/**
 * Shared handler for a profile create/select/delete operation carrying a target
 * profile name. `supported` gates on the controller's profile bridge.
 */
function handleProfileOperation(
  ctx: HandlerContext,
  operation: 'create' | 'switch' | 'delete',
): Handler {
  return async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const value = await parsePostBody(req, res)
    if (value === INVALID_BODY) return
    const name = parseProfileRequest(value)
    if (name === null) {
      return finishJson(res, 400, error(`invalid ${operation} profile request`, 'bad.profile'))
    }
    if (!ctx.controller.profileManagementSupported) {
      return finishJson(res, 501, error('current host does not support profile management', 'host.unsupported'))
    }
    let result: HostActionResult
    try {
      result = operation === 'create'
        ? await ctx.controller.createProfile(name)
        : operation === 'switch'
          ? await ctx.controller.selectProfile(name)
          : await ctx.controller.deleteProfile(name)
    } catch (cause) {
      ctx.reportError(`${operation} profile`, cause)
      finishJson(res, 500, error('profile operation failed', 'internal'))
      return
    }
    if (result.ok) {
      finishJson(res, 200, result.acceptance)
      return
    }
    finishJson(res, 501, error('current host could not complete this operation', result.code))
  }
}

/** POST create a new Web profile. */
export function handleProfileCreate(ctx: HandlerContext): Handler {
  return handleProfileOperation(ctx, 'create')
}

/** POST switch the active profile (relaunches the host). */
export function handleProfileSwitch(ctx: HandlerContext): Handler {
  return handleProfileOperation(ctx, 'switch')
}

/** POST delete an inactive profile. */
export function handleProfileDelete(ctx: HandlerContext): Handler {
  return handleProfileOperation(ctx, 'delete')
}
