import { History, LifeBuoy, Plug, Power, RotateCcw, Stethoscope, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { Button } from './components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { cn } from './lib/utils'
import { hasBridge, recoveryApi, type RecoveryCheckpointInspection, type RecoveryCheckpointSlot, type RecoveryProfile, type RecoveryStatus } from './recovery-api'
import { DiagnosticsPanel } from './panels/DiagnosticsPanel'
import { PluginsPanel } from './panels/PluginsPanel'
import { ProfilesPanel } from './panels/ProfilesPanel'
import { ReasonCard } from './panels/ReasonCard'
import { RollbackPanel } from './panels/RollbackPanel'

/**
 * The recovery page.
 *
 * STATE MODEL
 * -----------
 * One `busy` flag gates every action. Recovery operations restart the DSH child or
 * rewrite configuration; letting a second one start while the first is in flight is
 * how a user ends up with two half-applied changes. The flag also dims and disables
 * the UI, so the state is visible rather than merely enforced.
 *
 * Every failure surfaces in `notice` rather than being swallowed. A recovery page
 * that silently does nothing is worse than one that reports an error, because the
 * user has no other way to observe what happened.
 */
interface Notice {
  readonly kind: 'error' | 'info'
  readonly text: string
}

/** Whether recovery mode was entered on request rather than because startup failed. */
function isRequested(): boolean {
  return new URLSearchParams(window.location.search).get('requested') === '1'
}

function currentLocale(): 'zh' | 'en' {
  return new URLSearchParams(window.location.search).get('locale') === 'en' ? 'en' : 'zh'
}

export function App(): React.JSX.Element {
  const locale = currentLocale()
  const [status, setStatus] = useState<RecoveryStatus | undefined>(undefined)
  const [slots, setSlots] = useState<readonly RecoveryCheckpointSlot[]>([])
  const [inspections, setInspections] = useState<Record<string, RecoveryCheckpointInspection | undefined>>({})
  const [profiles, setProfiles] = useState<readonly RecoveryProfile[] | undefined>(undefined)
  const [startupLog, setStartupLog] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | undefined>(undefined)

  /** Run an operation with the busy gate, surfacing any failure as a notice. */
  const run = useCallback(async (label: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    try {
      await operation()
    } catch (error) {
      // A recovery action failing must be visible: the user has no other signal.
      setNotice({ kind: 'error', text: `${label}失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshStatus = useCallback(async (): Promise<void> => {
    setStatus(await recoveryApi.status())
  }, [])

  // Initial load. Without a bridge the page is being viewed outside the app, which
  // is a development case — say so plainly instead of rendering an empty shell.
  useEffect(() => {
    if (!hasBridge()) return
    let cancelled = false
    void (async () => {
      try {
        const [nextStatus, nextSlots, nextProfiles, log] = await Promise.all([
          recoveryApi.status(),
          recoveryApi.listCheckpoints(),
          recoveryApi.listProfiles(),
          recoveryApi.getStartupLog(),
        ])
        if (cancelled) return
        setStatus(nextStatus)
        setSlots(nextSlots)
        setProfiles(nextProfiles)
        setStartupLog(log)
      } catch (error) {
        if (cancelled) return
        setNotice({ kind: 'error', text: `读取恢复信息失败：${error instanceof Error ? error.message : String(error)}` })
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!hasBridge()) {
    return (
      <main className="flex h-screen items-center justify-center p-6">
        <Alert variant="destructive">
          <AlertTitle>恢复通道不可用</AlertTitle>
          <AlertDescription>本页面未运行在应用内，因此无法读取或修改任何状态。</AlertDescription>
        </Alert>
      </main>
    )
  }

  return (
    <main className={cn('flex h-screen flex-col gap-4 overflow-hidden p-5', busy && 'pointer-events-none opacity-70')}>
      <ReasonCard status={status} requested={isRequested()} />

      {notice === undefined
        ? null
        : (
            <Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
              <AlertTitle>{notice.kind === 'error' ? '操作未完成' : '提示'}</AlertTitle>
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          )}

      <Tabs defaultValue="quick" className="min-h-0 flex-1">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="quick"><LifeBuoy />快速恢复</TabsTrigger>
          <TabsTrigger value="plugins"><Plug />插件</TabsTrigger>
          <TabsTrigger value="rollback"><History />回滚</TabsTrigger>
          <TabsTrigger value="profiles"><Users />Profile</TabsTrigger>
          <TabsTrigger value="diagnostics"><Stethoscope />诊断</TabsTrigger>
        </TabsList>

        <TabsContent value="quick" className="overflow-auto p-1 pt-4">
          <div className="grid gap-4">
            <Alert>
              <LifeBuoy />
              <AlertTitle>可以尝试</AlertTitle>
              <AlertDescription>
                插件导致的问题：到「插件」卸载它。配置被改坏：到「回滚」恢复一份健康快照。
                Profile 坏了：到「Profile」换一个再重启。
              </AlertDescription>
            </Alert>
          </div>
        </TabsContent>

        <TabsContent value="plugins" className="min-h-0">
          <PluginsPanel
            status={status}
            busy={busy}
            onUninstall={packageName => {
              void run('卸载插件', async () => { setStatus(await recoveryApi.uninstall(packageName)) })
            }}
            onRestore={packageName => {
              void run('恢复插件', async () => { setStatus(await recoveryApi.restore(packageName)) })
            }}
            onKeepIsolated={packageName => {
              void run('保持隔离', async () => { setStatus(await recoveryApi.keepIsolated(packageName)) })
            }}
          />
        </TabsContent>

        <TabsContent value="rollback" className="min-h-0">
          <RollbackPanel
            slots={slots}
            inspections={inspections}
            locale={locale}
            busy={busy}
            onInspect={slotId => {
              void run('检查差异', async () => {
                const inspection = await recoveryApi.inspectCheckpoint(slotId)
                setInspections(current => ({ ...current, [slotId]: inspection }))
              })
            }}
            onRestore={slotId => {
              void run('回滚快照', async () => {
                await recoveryApi.restoreCheckpoint(slotId)
                await refreshStatus()
              })
            }}
          />
        </TabsContent>

        <TabsContent value="profiles" className="min-h-0">
          <ProfilesPanel profiles={profiles} />
        </TabsContent>

        <TabsContent value="diagnostics" className="min-h-0">
          <DiagnosticsPanel startupLog={startupLog} />
        </TabsContent>
      </Tabs>

      <footer className="flex shrink-0 items-center justify-end gap-2 border-t pt-4">
        {/* "Return to workbench" is only offered once the DSH server is actually
            running. The main process refuses the call otherwise ("DSH 尚未成功启动"),
            so this is a UX affordance rather than the protection — but offering a
            button that always fails is worse than disabling it. */}
        <Button
          variant="outline"
          disabled={busy || status?.running !== true}
          title={status?.running === true ? undefined : 'DSH 尚未成功启动'}
          onClick={() => { void run('返回工作台', async () => { await recoveryApi.returnToWorkbench() }) }}
        >
          <RotateCcw />
          返回工作台
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => { window.close() }}
        >
          <Power />
          退出
        </Button>
      </footer>
    </main>
  )
}
