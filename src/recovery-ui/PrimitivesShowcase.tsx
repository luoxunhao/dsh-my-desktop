import { ShieldCheck, RotateCcw, PackageX, History, Plug, Stethoscope, LifeBuoy, HardDrive } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from './components/ui/alert'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'

/**
 * Primitive showcase — the acceptance surface for the UI layer.
 *
 * This is NOT the recovery page. Its job is to make every primitive, variant and
 * colour token visible at once, in both colour schemes, so a regression in the
 * design layer is obvious by looking rather than by inspecting classes.
 *
 * It stays until the real panels exist (ticket 05), then becomes dead code.
 */
export function PrimitivesShowcase(): React.JSX.Element {
  return (
    <Tabs defaultValue="buttons">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="buttons"><Plug />按钮</TabsTrigger>
        <TabsTrigger value="cards"><History />卡片</TabsTrigger>
        <TabsTrigger value="alerts"><Stethoscope />警告</TabsTrigger>
        <TabsTrigger value="tokens"><HardDrive />色板</TabsTrigger>
      </TabsList>

      <TabsContent value="buttons" className="overflow-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>按钮变体</CardTitle>
            <CardDescription>与参考实现同名同值，逐字移植。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button>default</Button>
            <Button variant="outline">outline</Button>
            <Button variant="secondary">secondary</Button>
            <Button variant="ghost">ghost</Button>
            <Button variant="destructive"><PackageX />destructive</Button>
            <Button disabled>disabled</Button>
          </CardContent>
          <CardFooter className="flex-wrap gap-3 border-t pt-4">
            <Button size="sm">sm</Button>
            <Button>default</Button>
            <Button size="lg">lg</Button>
            <Button size="icon" aria-label="重试"><RotateCcw /></Button>
            <Button variant="outline"><ShieldCheck />带图标</Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="cards" className="overflow-auto p-4">
        <div className="grid gap-4">
          <Card>
            <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1.5">
                <CardTitle>槽位 2</CardTitle>
                <CardDescription>2026-09-10 19:22:12</CardDescription>
              </div>
              <Badge variant="secondary">可用</Badge>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[['桌面端版本', '0.1.4'], ['插件数', '7'], ['配置文易数', '7'], ['大小', '12.4 KB']].map(([label, value]) => (
                  <div key={label} className="rounded-lg border bg-muted/30 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
            <CardFooter className="flex-wrap justify-end gap-2 border-t bg-muted/20 pt-4">
              <Button variant="outline">打开位置</Button>
              <Button><RotateCcw />回滚到此快照</Button>
            </CardFooter>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="alerts" className="overflow-auto p-4">
        <div className="grid gap-3">
          <Alert>
            <LifeBuoy />
            <AlertTitle>已按请求进入恢复模式</AlertTitle>
            <AlertDescription>你从桌面端菜单选择了进入恢复模式。</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <PackageX />
            <AlertTitle>无法读取该能力</AlertTitle>
            <AlertDescription>数据目录管理在本版本中不可用。</AlertDescription>
          </Alert>
        </div>
      </TabsContent>

      <TabsContent value="tokens" className="overflow-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>色板</CardTitle>
            <CardDescription>切换系统深浅色，全部 token 应随之变化。</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {['background', 'card', 'muted', 'primary', 'secondary', 'destructive'].map(token => (
              <div key={token} className="flex items-center gap-3">
                <span className="w-28 text-muted-foreground">{token}</span>
                <span
                  className="h-6 flex-1 rounded border"
                  style={{ background: `var(--color-${token})` }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
