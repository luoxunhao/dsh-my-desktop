import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import type { RecoveryPlugin, RecoveryStatus } from '../recovery-api'

/**
 * Plugin management: see what is loaded, uninstall what broke, or put it back.
 *
 * The `isolated` list is what recovery mode has set aside. `restore` is offered for
 * each entry because uninstalling the wrong plugin is an easy mistake and being able
 * to undo it is the difference between "recoverable" and "now I must reinstall".
 */
export function PluginsPanel({ status, busy, onUninstall, onRestore, onKeepIsolated }: {
  readonly status: RecoveryStatus | undefined
  readonly busy: boolean
  readonly onUninstall: (packageName: string) => void
  readonly onRestore: (packageName: string) => void
  readonly onKeepIsolated: (packageName: string) => void
}): React.JSX.Element {
  const isolated: readonly RecoveryPlugin[] = status?.isolated ?? []
  const candidates = status?.candidates ?? []

  return (
    <div className="h-full space-y-4 overflow-auto p-1 pt-4">
      <Card>
        <CardHeader>
          <CardTitle>隔离的插件</CardTitle>
          <CardDescription>
            恢复模式已把这些插件排除在外。确认某个插件是原因后可以卸载它，卸错了也可以恢复。
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {isolated.length === 0
            ? <p className="px-6 py-5 text-sm text-muted-foreground">当前没有隔离的插件。</p>
            : isolated.map(plugin => (
                <div className="flex items-center justify-between gap-4 px-6 py-3" key={plugin.packageName}>
                  <p className="min-w-0 truncate text-sm font-medium">{plugin.packageName}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => { onKeepIsolated(plugin.packageName) }}
                    >
                      保持隔离
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => { onRestore(plugin.packageName) }}
                    >
                      恢复
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => { onUninstall(plugin.packageName) }}
                    >
                      卸载
                    </Button>
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
              <AlertTitle>启动失败时加载过的插件</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-1">
                  {candidates.map(candidate => (
                    <li key={candidate.packageName}>
                      <code className="text-xs">{candidate.packageName}</code>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
    </div>
  )
}
