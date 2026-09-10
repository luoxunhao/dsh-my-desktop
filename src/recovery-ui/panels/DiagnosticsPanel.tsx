import { ScrollText, Stethoscope } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

/**
 * Diagnostics — the startup log, which is usually the only evidence of why DSH did
 * not start.
 *
 * The log is rendered in a scrollable `<pre>` rather than truncated: a stack trace
 * cut off in the middle is worse than useless, and the window is sized for exactly
 * this. It is `select-text` so the user can copy it into a bug report.
 */
export function DiagnosticsPanel({ startupLog }: {
  readonly startupLog: string | undefined
}): React.JSX.Element {
  const empty = startupLog === undefined || startupLog.trim() === ''

  return (
    <div className="space-y-4 overflow-auto p-1 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="size-5" />
            启动日志
          </CardTitle>
          <CardDescription>
            最近一次 DSH 启动失败时记录的内容。可选中复制，便于排查或上报。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {empty
            ? <p className="text-sm text-muted-foreground">没有启动日志。可能尚未发生过启动失败。</p>
            : (
                <pre className="max-h-80 select-text overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-xs leading-relaxed">
                  {startupLog}
                </pre>
              )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="size-5" />
            关于隐私
          </CardTitle>
          <CardDescription>
            日志可能包含本机路径与插件名。分享前请先确认内容。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
