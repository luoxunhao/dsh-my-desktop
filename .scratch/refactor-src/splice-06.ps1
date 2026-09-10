# Ticket 06: replace extracted function bodies in main.ts with delegations.
#
# For each function owned by a new service module, replace its whole body with a
# call into the service. Keeps signatures so every existing call site is untouched.
$ErrorActionPreference = 'Stop'
$root = 'E:\project\dsh\dsh-my-desktop'
$file = Join-Path $root 'src\main.ts'
$lines = [System.Collections.Generic.List[string]](Get-Content $file)

# name -> replacement body lines (the `function name(...)` header is regenerated)
$delegations = [ordered]@{
  # notification service
  'notificationPreferencesPath' = @('  return requireNotificationService().notificationPreferencesPath()')
  'ensureWindowsNotificationIdentity' = @('  requireNotificationService().ensureWindowsNotificationIdentity()')
  'sendNotificationReplyToDsh' = @('  requireNotificationService().sendNotificationReplyToDsh(sessionId, text)')
  'installWindowsNotificationActivationHandler' = @('  requireNotificationService().installWindowsNotificationActivationHandler()')
  'notificationCopy' = @('  return requireNotificationService().notificationCopy(event)')
  'updateUnreadCompletionBadge' = @('  requireNotificationService().updateUnreadCompletionBadge(count)')
  'dismissNotificationsForSession' = @('  requireNotificationService().dismissNotificationsForSession(sessionId)')
  'focusMainWindowForNotification' = @('  requireNotificationService().focusMainWindowForNotification()')
  'openNotificationSession' = @('  requireNotificationService().openNotificationSession(sessionId)')
  'showNotificationReplyError' = @('  requireNotificationService().showNotificationReplyError(sessionId)')
  'showDesktopNotification' = @('  requireNotificationService().showDesktopNotification(event)')
  # update service
  'updatePreferencesPath' = @('  return requireUpdateService().updatePreferencesPath()')
  'setDesktopUpdateStatus' = @('  requireUpdateService().setDesktopUpdateStatus(status, checked)')
  'configureDesktopUpdater' = @('  requireUpdateService().configureDesktopUpdater()')
  'scheduleStartupUpdateCheck' = @('  requireUpdateService().scheduleStartupUpdateCheck()')
  'checkDesktopUpdate' = @('  await requireUpdateService().checkDesktopUpdate(interaction)')
  'downloadDesktopUpdate' = @('  await requireUpdateService().downloadDesktopUpdate(interaction)')
  'handleDesktopUpdateSettingsAction' = @('  await requireUpdateService().handleDesktopUpdateSettingsAction(action)')
  'dismissDesktopUpdateNotification' = @('  requireUpdateService().dismissDesktopUpdateNotification()')
  'showDesktopUpdateNotification' = @('  requireUpdateService().showDesktopUpdateNotification(kind, version)')
  'installDesktopUpdate' = @('  await requireUpdateService().installDesktopUpdate()')
  'desktopUpdateSnapshot' = @('  return requireUpdateService().desktopUpdateSnapshot()')
  # tray service
  'createTray' = @('  requireTrayService().createTray()')
  'refreshTrayMenu' = @('  requireTrayService().refreshTrayMenu()')
  'handleTrayUpdateAction' = @('  await requireTrayService().handleTrayUpdateAction(id)')
}

# Locate each top-level function and splice its body.
$targets = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^(?:export )?(?:async )?function ([A-Za-z_]\w*)') {
    $name = $Matches[1]
    if ($delegations.Contains($name)) {
      # find the header end (line containing `{`) and the matching closing `}` at col 0
      $headerEnd = $i
      while ($headerEnd -lt $lines.Count -and $lines[$headerEnd] -notmatch '\{\s*$') { $headerEnd++ }
      $bodyEnd = $headerEnd
      while ($bodyEnd -lt $lines.Count -and $lines[$bodyEnd] -ne '}') { $bodyEnd++ }
      $targets += [pscustomobject]@{ Name = $name; Start = $i; HeaderEnd = $headerEnd; End = $bodyEnd; Sig = $lines[$i] }
    }
  }
}
Write-Output "located $($targets.Count) of $($delegations.Count) functions"

# Splice from the bottom so earlier indices stay valid.
foreach ($t in ($targets | Sort-Object Start -Descending)) {
  $lines.RemoveRange($t.Start, $t.End - $t.Start + 1)
  $block = @($t.Sig) + $delegations[$t.Name] + @('}')
  $lines.InsertRange($t.Start, [string[]]$block)
}

[System.IO.File]::WriteAllLines($file, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "main.ts now $($lines.Count) lines"
