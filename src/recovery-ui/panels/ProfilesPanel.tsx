import { AlertTriangle, Users } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import type { RecoveryProfile } from '../recovery-api'

/**
 * Profile list — switching to a working profile is often the fastest way out of a
 * broken one.
 *
 * The panel does not DELETE profiles: the recovery window's job is to get the app
 * running again, and deletion is a destructive operation that belongs where the user
 * can see the consequences. `deletable` is therefore shown as information (it tells
 * the user which profiles are in use) rather than as a button.
 */
export function ProfilesPanel({ profiles }: {
  readonly profiles: readonly RecoveryProfile[] | undefined
}): React.JSX.Element {
  if (profiles === undefined) {
    return (
      <div className="overflow-auto p-1 pt-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>无法读取 Profile 列表</AlertTitle>
          <AlertDescription>恢复通道未返回数据。</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="h-full space-y-4 overflow-auto p-1 pt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="size-5" />Profile</CardTitle>
          <CardDescription>
            切换到另一个 Profile 后重启，可以绕开当前 Profile 的配置问题。
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {profiles.length === 0
            ? <p className="px-6 py-5 text-sm text-muted-foreground">没有找到任何 Profile。</p>
            : profiles.map(profile => (
                <div className="flex items-center justify-between gap-4 px-6 py-3" key={profile.name}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{profile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile.webCapable ? '可用于 Web' : '不适用于 Web'}
                      {profile.problem === null ? '' : ` · ${profile.problem}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {profile.current ? <Badge>当前</Badge> : null}
                    {profile.deletable ? null : <Badge variant="secondary">使用中</Badge>}
                  </div>
                </div>
              ))}
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle />
        <AlertTitle>切换 Profile 需要重启</AlertTitle>
        <AlertDescription>
          在「设置」里选择并切换；本页只展示当前可用的 Profile 及其状态。
          数据不会在 Profile 之间复制。
        </AlertDescription>
      </Alert>
    </div>
  )
}
