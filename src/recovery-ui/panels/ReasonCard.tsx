import { AlertTriangle, LifeBuoy } from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { Card, CardContent } from '../components/ui/card'
import { cn } from '../lib/utils'
import type { RecoveryStatus } from '../recovery-api'

/**
 * Why the user is looking at the recovery page.
 *
 * TWO CASES, and the distinction matters to the user:
 *
 *   - `requested` — they asked for recovery mode. Nothing is broken; they came here
 *     on purpose. Showing an alarming "something failed" panel would be wrong.
 *   - otherwise — something DID fail, and the message plus the suspected plugin are
 *     the most useful facts on the page, so they are shown up front.
 */
export function ReasonCard({ status, requested }: {
  readonly status: RecoveryStatus | undefined
  readonly requested: boolean
}): React.JSX.Element {
  const suspected = status?.suspectedPlugin
  const failure = status?.failureMessage

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
            <h2 className="text-sm font-semibold">{requested ? '已进入恢复模式' : 'DSH 启动失败'}</h2>
            {status?.active === true ? <Badge variant="secondary">恢复模式已启用</Badge> : null}
          </div>

          {requested
            ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  你可以在这里卸载导致问题的插件、回滚配置快照，或切换 Profile 后重启。
                </p>
              )
            : (
                <>
                  {suspected === undefined
                    ? null
                    : (
                        <p className="mt-1 text-sm font-medium">
                          疑似插件：<code className="rounded bg-muted px-1.5 py-0.5 text-xs">{suspected}</code>
                        </p>
                      )}
                  {failure === undefined
                    ? null
                    : (
                        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2.5 text-xs leading-relaxed">
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
