import { AlertTriangle, FolderOpen, History, RotateCcw } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import type { RecoveryCheckpointInspection, RecoveryCheckpointSlot } from '../recovery-api'

/**
 * Checkpoint rollback — the panel that finally makes the health-snapshot work
 * visible to users.
 *
 * `changedFiles` comes from an explicit inspection rather than being shown up front:
 * inspecting reads and hashes every checkpointed file, so doing it for all three
 * slots on every render would be wasted work. The user asks when they are deciding.
 */
function formatBytes(bytes: number, locale: 'zh' | 'en'): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]!
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024
    unit = units[index]!
  }
  return `${new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(value)} ${unit}`
}

function Fact({ label, value }: { readonly label: string, readonly value: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  )
}

export function RollbackPanel({ slots, inspections, locale, busy, onInspect, onRestore }: {
  readonly slots: readonly RecoveryCheckpointSlot[]
  readonly inspections: Readonly<Record<string, RecoveryCheckpointInspection | undefined>>
  readonly locale: 'zh' | 'en'
  readonly busy: boolean
  readonly onInspect: (slotId: string) => void
  readonly onRestore: (slotId: string, sourceProfile: string) => void
}): React.JSX.Element {
  const numberLocale = locale === 'zh' ? 'zh-CN' : 'en-US'
  const anyAvailable = slots.some(slot => slot.status === 'available')

  return (
    <div className="h-full space-y-4 overflow-auto p-1 pt-4">
      {anyAvailable
        ? null
        : (
            <Alert>
              <AlertTriangle />
              <AlertTitle>没有可用的快照</AlertTitle>
              <AlertDescription>
                每次正常启动都会记录一份配置快照。目前三个槽位都是空的，所以无法回滚。
              </AlertDescription>
            </Alert>
          )}

      <div className="grid grid-cols-1 gap-4">
        {slots.map(slot => {
          const inspection = inspections[slot.slotId]
          const available = slot.status === 'available'
          return (
            <Card key={slot.slotId} className="w-full overflow-hidden">
              <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    <History className="size-4" />
                    {locale === 'zh' ? `槽位 ${slot.slotId.slice(-1)}` : `Slot ${slot.slotId.slice(-1)}`}
                  </CardTitle>
                  <CardDescription>
                    {!available
                      ? '尚未记录任何健康启动'
                      : slot.capturedAt === undefined
                        ? '已记录'
                        : new Date(slot.capturedAt).toLocaleString(numberLocale)}
                  </CardDescription>
                </div>
                <Badge variant="secondary">{available ? '可用' : '空槽'}</Badge>
              </CardHeader>

              {!available
                ? null
                : (
                    <>
                      <CardContent className="space-y-3">
                        {/* Four facts, matching the reference implementation's slot card:
                            version / plugins / configuration files / size. The plugin
                            count is the one users compare slots by. */}
                        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Fact label="桌面端版本" value={slot.appVersion ?? '未知'} />
                          <Fact label="插件" value={slot.pluginCount === undefined ? '未知' : `${slot.pluginCount} 个`} />
                          <Fact label="配置文件" value={`${slot.fileCount ?? 0} 个`} />
                          <Fact label="Checkpoint 大小" value={formatBytes(slot.totalBytes ?? 0, locale)} />
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
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => { onInspect(slot.slotId) }}
                        >
                          <FolderOpen />
                          检查差异
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() => { onRestore(slot.slotId, slot.profileName) }}
                        >
                          <RotateCcw />
                          回滚到此快照
                        </Button>
                      </CardFooter>
                    </>
                  )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
