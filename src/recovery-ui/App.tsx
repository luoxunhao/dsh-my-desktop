import {
  AlertTriangle,
  Archive,
  CircleHelp,
  FilePenLine,
  FolderInput,
  FolderOpen,
  HardDrive,
  History,
  LifeBuoy,
  PackageX,
  Plug,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { RecoveryAction, RecoveryActionFooter, RecoveryNoticeSurface, type RecoveryNotice } from './components/RecoveryWindowPrimitives.js'
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert.js'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card.js'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.js'
import { cn } from './lib/utils.js'
import { recoveryCopy, type RecoveryCopy } from './recovery-copy.js'
import {
  hasBridge,
  recoveryApi,
  type RecoveryCheckpointInspection,
  type RecoveryCheckpointSlot,
  type RecoveryDataDirectory,
  type RecoveryOpenTarget,
  type RecoveryPlugin,
  type RecoveryProfile,
  type RecoveryStatus,
} from './recovery-api.js'

/**
 * The recovery page.
 *
 * A 1:1 port of dsh-desktop's `native-ui/recovery/App.tsx`: same six tabs in the same
 * order, the same reason card (with its Profile and Profile-directory chips), the same
 * card anatomy inside every panel, and the same footer. All wording comes from
 * `recovery-copy.ts`, so parity stays diffable against the reference.
 *
 * WHERE ACTIONS COME FROM (the one deliberate divergence)
 * ------------------------------------------------------
 * The reference emits `dsh-recovery://` links that its main process intercepts. Our
 * page is sandboxed behind a fixed preload bridge, so actions call typed API methods.
 * Same buttons in the same places — different transport.
 */

function locale(): 'zh' | 'en' {
  return new URLSearchParams(window.location.search).get('locale') === 'en' ? 'en' : 'zh'
}

/** Whether the user asked for recovery rather than arriving after a failure. */
function requestedRecovery(): boolean {
  return new URLSearchParams(window.location.search).get('requested') === '1'
}

/** Whether THIS generation runs in the disposable Safe Mode environment. */
function safeModeRequested(): boolean {
  return new URLSearchParams(window.location.search).get('safeMode') === '1'
}

/** Panel body wrapper: the reference pairs its ScrollArea with this spacing. */
function PanelScroll({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="h-full space-y-4 overflow-auto pb-2 pr-3 pt-4">{children}</div>
}

function formatCheckpointSize(bytes: number, loc: 'zh' | 'en'): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]!
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024
    unit = units[index]!
  }
  return `${new Intl.NumberFormat(loc === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(value)} ${unit}`
}

/** One fact tile inside a checkpoint card (the reference's CheckpointFact). */
function CheckpointFact({ label, value }: { readonly label: string, readonly value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  )
}

/** The status pill on a checkpoint card: 可回滚 / 空槽. */
function StatusPill({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function RollbackPanel({ copy, loc, busy, slots, inspections, onInspect, onRestore }: {
  readonly copy: RecoveryCopy
  readonly loc: 'zh' | 'en'
  readonly busy: boolean
  readonly slots: readonly RecoveryCheckpointSlot[]
  readonly inspections: Readonly<Record<string, RecoveryCheckpointInspection | undefined>>
  readonly onInspect: (slotId: string) => void
  readonly onRestore: (slotId: string, sourceProfile: string) => void
}): React.JSX.Element {
  const numberLocale = loc === 'zh' ? 'zh-CN' : 'en-US'
  return (
    <PanelScroll>
      <div className="grid grid-cols-1 gap-4">
        {slots.map(checkpoint => {
          const slotNumber = checkpoint.slotId.slice(-1)
          const available = checkpoint.status === 'available'
          const inspection = inspections[checkpoint.slotId]
          return (
            <Card className="w-full overflow-hidden" key={checkpoint.slotId}>
              <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <CardTitle>{loc === 'zh' ? `槽位 ${slotNumber}` : `Slot ${slotNumber}`}</CardTitle>
                  <CardDescription>
                    {!available
                      ? copy.noHealthyStartup
                      : checkpoint.capturedAt === undefined
                        ? copy.rollbackBody
                        : new Date(checkpoint.capturedAt).toLocaleString(numberLocale)}
                  </CardDescription>
                </div>
                <StatusPill>{available ? copy.availableSlot : copy.emptySlot}</StatusPill>
              </CardHeader>
              {!available
                ? null
                : (
                    <>
                      <CardContent className="space-y-3">
                        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <CheckpointFact label={copy.desktopVersion} value={checkpoint.appVersion ?? copy.unknown} />
                          {checkpoint.pluginCount === undefined
                            ? null
                            : <CheckpointFact label={copy.pluginCount} value={loc === 'zh' ? `${checkpoint.pluginCount} 个` : checkpoint.pluginCount.toLocaleString(numberLocale)} />}
                          <CheckpointFact label={copy.configurationFileCount} value={loc === 'zh' ? `${checkpoint.fileCount ?? 0} 个` : (checkpoint.fileCount ?? 0).toLocaleString(numberLocale)} />
                          {checkpoint.totalBytes === undefined
                            ? null
                            : <CheckpointFact label={copy.checkpointSize} value={formatCheckpointSize(checkpoint.totalBytes, loc)} />}
                        </dl>
                        {inspection === undefined
                          ? null
                          : (
                              <p className="text-xs text-muted-foreground">
                                {inspection.currentDiffers
                                  ? `与当前配置不同，回滚将改动：${inspection.changedFiles.join('、')}`
                                  : '与当前配置一致，回滚不会改动任何文件。'}
                              </p>
                            )}
                      </CardContent>
                      <CardFooter className="flex-wrap justify-end gap-2 border-t bg-muted/20 px-6 py-4">
                        <RecoveryAction disabled={busy} icon={<FolderOpen />} onClick={() => { onInspect(checkpoint.slotId) }}>
                          {copy.openCheckpoint}
                        </RecoveryAction>
                        <RecoveryAction disabled={busy} icon={<RotateCcw />} onClick={() => { onRestore(checkpoint.slotId, checkpoint.profileName) }} variant="default">
                          {copy.rollbackCheckpoint}
                        </RecoveryAction>
                      </CardFooter>
                    </>
                  )}
            </Card>
          )
        })}
      </div>
    </PanelScroll>
  )
}

function PluginsPanel({ copy, busy, status, onUninstall, onRestore, onKeepIsolated }: {
  readonly copy: RecoveryCopy
  readonly busy: boolean
  readonly status: RecoveryStatus | undefined
  readonly onUninstall: (packageName: string) => void
  readonly onRestore: (packageName: string) => void
  readonly onKeepIsolated: (packageName: string) => void
}): React.JSX.Element {
  const isolated: readonly RecoveryPlugin[] = status?.isolated ?? []
  const candidates = status?.candidates ?? []
  return (
    <PanelScroll>
      <Card>
        <CardHeader>
          <CardTitle>{copy.isolatedPlugins}</CardTitle>
          <CardDescription>{copy.isolatedPluginsBody}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {isolated.length === 0
            ? <p className="px-6 py-5 text-sm text-muted-foreground">{copy.isolatedPluginsEmpty}</p>
            : isolated.map((plugin: RecoveryPlugin) => (
                <div className="flex items-center justify-between gap-4 px-6 py-3" key={plugin.packageName}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{plugin.packageName}</p>
                    <p className="text-xs text-muted-foreground">{copy.profileDependency}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <RecoveryAction disabled={busy} onClick={() => { onKeepIsolated(plugin.packageName) }}>
                      {copy.keepIsolated}
                    </RecoveryAction>
                    <RecoveryAction disabled={busy} onClick={() => { onRestore(plugin.packageName) }}>
                      {copy.restore}
                    </RecoveryAction>
                    <RecoveryAction disabled={busy} icon={<PackageX />} onClick={() => { onUninstall(plugin.packageName) }} variant="destructive">
                      {copy.uninstall}
                    </RecoveryAction>
                  </div>
                </div>
              ))}
        </CardContent>
      </Card>
      {candidates.length === 0
        ? null
        : (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{copy.plugins}</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1">
                  {candidates.map((candidate: { readonly packageName: string }) => (
                    <li key={candidate.packageName}><code className="text-xs">{candidate.packageName}</code></li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
    </PanelScroll>
  )
}

function ProfilesPanel({ copy, busy, onSwitch }: { readonly copy: RecoveryCopy, readonly busy: boolean, readonly onSwitch: (name: string) => void }): React.JSX.Element {
  const [profiles, setProfiles] = useState<readonly RecoveryProfile[] | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!hasBridge()) return
    void recoveryApi.listProfiles().then(setProfiles).catch((error: unknown) => {
      setProblem(error instanceof Error ? error.message : String(error))
    })
  }, [])

  if (profiles === undefined) {
    return (
      <PanelScroll>
        <Alert>
          <Users />
          <AlertTitle>{copy.profiles}</AlertTitle>
          <AlertDescription>{problem ?? copy.profilesUnavailable}</AlertDescription>
        </Alert>
      </PanelScroll>
    )
  }

  // Phase A renders the list faithfully. The 切换 / 新建 actions need launcher-side
  // support that does not exist yet, so they are absent rather than present-and-dead.
  const hasAlternative = profiles.some(profile => !profile.current && profile.selectable)

  return (
    <PanelScroll>
      <Card className="w-full overflow-hidden">
        <CardHeader>
          <CardTitle>{copy.profiles}</CardTitle>
          <CardDescription>{copy.profilesBody}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {profiles.map(profile => (
            <div className="flex items-center justify-between gap-4 px-6 py-3" key={profile.name}>
              <span className="min-w-0 truncate text-sm font-medium">{profile.name}</span>
              {profile.current
                ? <span className="rounded-full bg-muted px-2 py-1 text-xs">{copy.currentProfile}</span>
                : profile.selectable
                  ? <RecoveryAction disabled={busy} onClick={() => { onSwitch(profile.name) }}>{copy.switchProfile}</RecoveryAction>
                  : null}
            </div>
          ))}
          {hasAlternative ? null : <p className="px-6 py-5 text-sm text-muted-foreground">{copy.profilesEmpty}</p>}
        </CardContent>
      </Card>
    </PanelScroll>
  )
}

function RecoveryGuideCard({ body, icon, title }: {
  readonly body: string
  readonly icon: React.ReactNode
  readonly title: string
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function QuickRecoveryPanel({ busy, copy, onEnterSafeMode, safeModeActive }: { readonly busy: boolean, readonly copy: RecoveryCopy, readonly onEnterSafeMode: () => void, readonly safeModeActive: boolean }): React.JSX.Element {
  return (
    <PanelScroll>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CircleHelp className="size-5" />{copy.quickRecovery}</CardTitle>
          <CardDescription>{copy.quickRecoveryBody}</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />{copy.safeMode}</CardTitle>
          {/* Active state shows the "how to leave" copy and NO button — re-entering
              while already inside would just restart into the same thing. */}
          <CardDescription>{safeModeActive ? copy.safeModeActiveBody : copy.safeModeBody}</CardDescription>
        </CardHeader>
        {safeModeActive ? null : (
          <CardFooter className="justify-end">
            <RecoveryAction
              disabled={busy}
              icon={<ShieldCheck />}
              onClick={onEnterSafeMode}
              variant="default"
            >
              {copy.enterSafeMode}
            </RecoveryAction>
          </CardFooter>
        )}
      </Card>
      <RecoveryGuideCard body={copy.pluginGuideBody} icon={<Plug className="size-5" />} title={copy.tabs.plugins} />
      <RecoveryGuideCard body={copy.rollbackGuideBody} icon={<History className="size-5" />} title={copy.tabs.rollback} />
      <RecoveryGuideCard body={copy.profileSwitchGuideBody} icon={<Users className="size-5" />} title={copy.tabs.profiles} />
      <RecoveryGuideCard body={copy.dataGuideBody} icon={<HardDrive className="size-5" />} title={copy.tabs.data} />
      <RecoveryGuideCard body={copy.diagnosticsGuideBody} icon={<Stethoscope className="size-5" />} title={copy.tabs.diagnostics} />
    </PanelScroll>
  )
}

function DataManagementPanel({ copy, dataDirectory, busy, onSelect, onReset }: {
  readonly copy: RecoveryCopy
  readonly dataDirectory: RecoveryDataDirectory | undefined
  readonly busy: boolean
  readonly onSelect: (target: string | null) => void
  readonly onReset: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (dataDirectory === undefined) {
    return (
      <PanelScroll>
        <Alert>
          <HardDrive />
          <AlertTitle>{copy.resetAndDataManagement}</AlertTitle>
          <AlertDescription>{copy.dataDirectoryUnavailable}</AlertDescription>
        </Alert>
      </PanelScroll>
    )
  }

  return (
    <PanelScroll>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HardDrive className="size-5" />{copy.dataManagement}</CardTitle>
          <CardDescription>{copy.dataManagementBody}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">{copy.currentDataDirectory}</p>
          <code className="block select-text break-all rounded-lg bg-muted p-3 text-xs">{dataDirectory.currentDirectory}</code>
        </CardContent>
        {editing
          ? (
              <div className="space-y-3 border-t px-6 py-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="data-directory-path">{copy.dataDirectoryPath}</label>
                  <input
                    autoFocus
                    className="flex h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
                    id="data-directory-path"
                    onChange={event => { setDraft(event.target.value) }}
                    onKeyDown={event => { if (event.key === 'Enter' && draft.trim().length > 0) { onSelect(draft.trim()); setEditing(false) } }}
                    placeholder={copy.dataDirectoryPlaceholder}
                    value={draft}
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <RecoveryAction onClick={() => { setEditing(false); setDraft('') }}>{copy.cancelDataDirectoryChange}</RecoveryAction>
                  <RecoveryAction
                    disabled={busy || draft.trim().length === 0}
                    icon={<FolderInput />}
                    onClick={() => { onSelect(draft.trim()); setEditing(false) }}
                    variant="default"
                  >
                    {copy.applyDataDirectory}
                  </RecoveryAction>
                </div>
              </div>
            )
          : (
              <CardFooter className="flex-wrap justify-end gap-2">
                {dataDirectory.usingDefaultDirectory
                  ? null
                  : <RecoveryAction disabled={busy} icon={<RotateCcw />} onClick={() => { onSelect(null) }}>{copy.restoreDefaultDataDirectory}</RecoveryAction>}
                <RecoveryAction disabled={busy} icon={<FolderInput />} onClick={() => { setEditing(true) }} variant="default">
                  {copy.changeDataDirectory}
                </RecoveryAction>
              </CardFooter>
            )}
      </Card>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="size-5" />{copy.factoryReset}</CardTitle>
          <CardDescription>{copy.factoryResetBody}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-end">
          <RecoveryAction disabled={busy} icon={<Trash2 />} onClick={onReset} variant="destructive">
            {copy.factoryResetAction}
          </RecoveryAction>
        </CardFooter>
      </Card>
    </PanelScroll>
  )
}

function DiagnosticsPanel({ copy, startupLog, busy, onOpen, onExport, onShow, exportedName }: {
  readonly copy: RecoveryCopy
  readonly startupLog: string | undefined
  readonly busy: boolean
  readonly onOpen: (target: RecoveryOpenTarget) => void
  readonly onExport: () => void
  readonly onShow: () => void
  readonly exportedName: string | undefined
}): React.JSX.Element {
  const empty = startupLog === undefined || startupLog.trim() === ''
  return (
    <PanelScroll>
      <Card>
        <CardHeader>
          <CardTitle>{copy.startupLog}</CardTitle>
          <CardDescription>{copy.startupLogBody}</CardDescription>
        </CardHeader>
        <CardContent>
          {empty
            ? <p className="text-sm text-muted-foreground">{copy.startupLogEmpty}</p>
            : (
                <pre className="max-h-80 select-text overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs leading-relaxed">
                  {startupLog}
                </pre>
              )}
          <p className="mt-2 text-xs text-muted-foreground">{copy.privacy}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{copy.configurationFiles}</CardTitle>
          <CardDescription>{copy.configurationFilesBody}</CardDescription>
        </CardHeader>
        <CardFooter className="flex-wrap gap-2 pt-6">
          <RecoveryAction disabled={busy} icon={<FilePenLine />} onClick={() => { onOpen('settings-document') }}>{copy.openSettingsDocument}</RecoveryAction>
          <RecoveryAction disabled={busy} icon={<FilePenLine />} onClick={() => { onOpen('profile-patch') }}>{copy.openProfilePatch}</RecoveryAction>
          <RecoveryAction disabled={busy} icon={<FilePenLine />} onClick={() => { onOpen('profile-manifest') }}>{copy.openProfileManifest}</RecoveryAction>
          <RecoveryAction disabled={busy} icon={<FolderOpen />} onClick={() => { onOpen('profile-directory') }}>{copy.openProfileDirectory}</RecoveryAction>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{copy.diagnostics}</CardTitle>
          <CardDescription>{exportedName === undefined ? copy.savingDiagnostics : copy.diagnosticsSaved}</CardDescription>
        </CardHeader>
        <CardContent>
          {exportedName === undefined ? null : <code className="block select-text break-all rounded-lg bg-muted p-3 text-xs">{exportedName}</code>}
          <p className="mt-2 text-xs text-muted-foreground">{copy.privacy}</p>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2">
          <RecoveryAction disabled={busy || exportedName === undefined} icon={<FolderOpen />} onClick={onShow}>{copy.showDiagnostics}</RecoveryAction>
          <RecoveryAction disabled={busy} icon={<Archive />} onClick={onExport} variant="default">{copy.saveDiagnostics}</RecoveryAction>
        </CardFooter>
      </Card>
    </PanelScroll>
  )
}

/** The reason card: why recovery started, plus the Profile context chips. */
function Reason({ copy, status, requested, profileDirectory }: {
  readonly copy: RecoveryCopy
  readonly status: RecoveryStatus | undefined
  readonly requested: boolean
  readonly profileDirectory: string | undefined
}): React.JSX.Element {
  const suspected = status?.suspectedPlugin
  const failure = status?.failureMessage
  const profileName = profileDirectory === undefined
    ? undefined
    : profileDirectory.split(/[\\/]/).filter(Boolean).pop()
  return (
    <Card className={cn('shrink-0', requested ? 'border-border' : 'border-amber-500/50')}>
      <CardContent className="flex gap-4 p-4">
        <div className="mt-0.5 shrink-0">
          {requested
            ? <LifeBuoy className="size-5 text-muted-foreground" />
            : <AlertTriangle className="size-5 text-amber-500" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold">{copy.reason}</h2>
            {profileName === undefined
              ? null
              : <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{copy.currentProfile}: {profileName}</span>}
            {profileDirectory === undefined
              ? null
              : (
                  <span className="inline-flex min-w-0 max-w-full items-center rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                    <span className="shrink-0">{copy.currentProfileDirectory}:&nbsp;</span>
                    <code className="truncate select-text" title={profileDirectory}>{profileDirectory}</code>
                  </span>
                )}
          </div>
          {requested
            ? (
                <>
                  <p className="mt-1 text-sm font-medium">{copy.requestedMode}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{copy.requestedBody}</p>
                </>
              )
            : (
                <>
                  {suspected === undefined
                    ? null
                    : <p className="mt-1 text-xs text-muted-foreground">{copy.pluginCount}: {suspected}</p>}
                  {failure === undefined
                    ? null
                    : (
                        <pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2.5 text-xs leading-relaxed">
                          {failure}
                        </pre>
                      )}
                </>
              )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App(): React.JSX.Element {
  const loc = locale()
  const copy = useMemo(() => recoveryCopy(loc), [loc])
  const requested = requestedRecovery()
  const safeMode = safeModeRequested()

  const [status, setStatus] = useState<RecoveryStatus | undefined>(undefined)
  const [slots, setSlots] = useState<readonly RecoveryCheckpointSlot[]>([])
  const [inspections, setInspections] = useState<Record<string, RecoveryCheckpointInspection | undefined>>({})
  const [startupLog, setStartupLog] = useState<string | undefined>(undefined)
  const [dataDirectory, setDataDirectory] = useState<RecoveryDataDirectory | undefined>(undefined)
  const [exportedName, setExportedName] = useState<string | undefined>(undefined)
  const [profileDirectory, setProfileDirectory] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<RecoveryNotice | undefined>(undefined)

  const run = useCallback(async (title: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    try {
      await operation()
    } catch (error) {
      setNotice({ tone: 'error', title, body: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    setStatus(await recoveryApi.status())
  }, [])

  useEffect(() => {
    if (!hasBridge()) return
    let cancelled = false
    void (async () => {
      try {
        const [nextStatus, nextSlots, log, data] = await Promise.all([
          recoveryApi.status(),
          recoveryApi.listCheckpoints(),
          recoveryApi.getStartupLog(),
          recoveryApi.dataDirectory(),
        ])
        if (cancelled) return
        setStatus(nextStatus)
        setSlots(nextSlots)
        setStartupLog(log)
        setDataDirectory(data)
      } catch (error) {
        if (cancelled) return
        setNotice({ tone: 'error', title: copy.diagnosticsFailed, body: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => { cancelled = true }
  }, [copy])

  // The reason card needs the profile PATH, which the status deliberately does not
  // carry; it is derived from the active profile's directory name.
  useEffect(() => {
    if (!hasBridge()) return
    let cancelled = false
    void recoveryApi.listProfiles().then(profiles => {
      if (cancelled) return
      const current = profiles.find(profile => profile.current)
      if (current !== undefined) setProfileDirectory(current.name)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  if (!hasBridge()) {
    return (
      <main className="flex h-screen items-center justify-center p-6">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>{copy.title}</AlertTitle>
          <AlertDescription>{copy.fallbackBody}</AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <>
      <main className={cn('h-screen overflow-hidden p-5 sm:p-6', busy && 'pointer-events-none opacity-70')}>
        <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4">
          <Reason copy={copy} profileDirectory={profileDirectory} requested={requested} status={status} />

          <Tabs className="min-h-0 flex-1" defaultValue={(window as { __TAB_OVERRIDE?: string }).__TAB_OVERRIDE ?? new URLSearchParams(window.location.search).get('tab') ?? 'quick'}>
            <TabsList className="w-full justify-start overflow-x-auto">
              <TabsTrigger value="quick"><LifeBuoy />{copy.tabs.quick}</TabsTrigger>
              <TabsTrigger value="plugins"><Plug />{copy.tabs.plugins}</TabsTrigger>
              <TabsTrigger value="rollback"><History />{copy.tabs.rollback}</TabsTrigger>
              <TabsTrigger value="profiles"><Users />{copy.tabs.profiles}</TabsTrigger>
              <TabsTrigger value="data"><HardDrive />{copy.tabs.data}</TabsTrigger>
              <TabsTrigger value="diagnostics"><Stethoscope />{copy.tabs.diagnostics}</TabsTrigger>
            </TabsList>

            <TabsContent className="min-h-0" value="quick">
              <QuickRecoveryPanel
                busy={busy}
                copy={copy}
                safeModeActive={safeMode}
                onEnterSafeMode={() => {
                  void run(copy.enterSafeMode, async () => { await recoveryApi.enterSafeMode() })
                }}
              />
            </TabsContent>

            <TabsContent className="min-h-0" value="plugins">
              <PluginsPanel
                busy={busy}
                copy={copy}
                onKeepIsolated={packageName => { void run(copy.keepIsolated, async () => { setStatus(await recoveryApi.keepIsolated(packageName)) }) }}
                onRestore={packageName => { void run(copy.restore, async () => { setStatus(await recoveryApi.restore(packageName)) }) }}
                onUninstall={packageName => { void run(copy.uninstall, async () => { setStatus(await recoveryApi.uninstall(packageName)) }) }}
                status={status}
              />
            </TabsContent>

            <TabsContent className="min-h-0" value="rollback">
              <RollbackPanel
                busy={busy}
                copy={copy}
                inspections={inspections}
                loc={loc}
                onInspect={slotId => {
                  void run(copy.openCheckpoint, async () => {
                    const inspection = await recoveryApi.inspectCheckpoint(slotId)
                    setInspections(current => ({ ...current, [slotId]: inspection }))
                  })
                }}
                onRestore={(slotId, sourceProfile) => {
                  void run(copy.rollbackCheckpoint, async () => {
                    await recoveryApi.restoreCheckpoint(`${slotId}@${sourceProfile}`)
                    await refreshStatus()
                  })
                }}
                slots={slots}
              />
            </TabsContent>

            <TabsContent className="min-h-0" value="profiles">
              <ProfilesPanel
                busy={busy}
                copy={copy}
                onSwitch={name => {
                  void run(copy.switchProfile, async () => { await recoveryApi.switchProfile(name) })
                }}
              />
            </TabsContent>

            <TabsContent className="min-h-0" value="data">
              <DataManagementPanel
                busy={busy}
                copy={copy}
                dataDirectory={dataDirectory}
                onReset={() => {
                  void run(copy.factoryResetAction, async () => {
                    await recoveryApi.factoryReset()
                    setNotice({ tone: 'success', title: copy.factoryResetAction, body: copy.dataManagementBody })
                  })
                }}
                onSelect={target => {
                  void run(copy.applyDataDirectory, async () => {
                    setDataDirectory(await recoveryApi.selectDataDirectory(target))
                  })
                }}
              />
            </TabsContent>

            <TabsContent className="min-h-0" value="diagnostics">
              <DiagnosticsPanel
                busy={busy}
                copy={copy}
                exportedName={exportedName}
                onExport={() => {
                  void run(copy.saveDiagnostics, async () => {
                    setExportedName(await recoveryApi.exportDiagnostics())
                    setNotice({ tone: 'success', title: copy.diagnosticsSaved, body: copy.privacy })
                  })
                }}
                onOpen={target => {
                  void run(copy.configurationFiles, async () => { await recoveryApi.openTarget(target) })
                }}
                onShow={() => {
                  void run(copy.showDiagnostics, async () => { await recoveryApi.showDiagnostics() })
                }}
                startupLog={startupLog}
              />
            </TabsContent>
          </Tabs>

          <RecoveryActionFooter
            leading={busy
              ? (
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className="size-4 animate-spin" />
                    {copy.working}
                  </span>
                )
              : undefined}
          >
            <RecoveryAction
              disabled={busy}
              icon={<RotateCcw />}
              onClick={() => { void run(copy.restart, async () => { await recoveryApi.restartDesktop() }) }}
              variant='default'
            >
              {copy.restart}
            </RecoveryAction>
            <RecoveryAction disabled={busy} icon={<Power />} onClick={() => { window.close() }}>{copy.quit}</RecoveryAction>
          </RecoveryActionFooter>
        </div>
      </main>
      <RecoveryNoticeSurface notice={notice} />
    </>
  )
}
