const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const RECOVERY_IPC = {
  activate: 'dsh-recovery:activate',
  getStatus: 'dsh-recovery:get-status',
  keepIsolated: 'dsh-recovery:keep-isolated',
  getStartupLog: 'dsh-recovery:get-startup-log',
  restore: 'dsh-recovery:restore',
  restoreHealthyConfig: 'dsh-recovery:restore-healthy-config',
  returnToWorkbench: 'dsh-recovery:return-to-workbench',
  uninstall: 'dsh-recovery:uninstall',
  // Checkpoints and profiles — capabilities that already existed in the backend but
  // had no way to reach the recovery page.
  listCheckpoints: 'dsh-recovery:list-checkpoints',
  inspectCheckpoint: 'dsh-recovery:inspect-checkpoint',
  listProfiles: 'dsh-recovery:list-profiles',
} as const

contextBridge.exposeInMainWorld('dshRecovery', {
  activate: () => ipcRenderer.invoke(RECOVERY_IPC.activate),
  getStatus: () => ipcRenderer.invoke(RECOVERY_IPC.getStatus),
  keepIsolated: (packageName: string) => ipcRenderer.invoke(RECOVERY_IPC.keepIsolated, packageName),
  getStartupLog: () => ipcRenderer.invoke(RECOVERY_IPC.getStartupLog),
  restore: (packageName: string) => ipcRenderer.invoke(RECOVERY_IPC.restore, packageName),
  restoreHealthyConfig: () => ipcRenderer.invoke(RECOVERY_IPC.restoreHealthyConfig),
  returnToWorkbench: () => ipcRenderer.invoke(RECOVERY_IPC.returnToWorkbench),
  uninstall: (packageName: string) => ipcRenderer.invoke(RECOVERY_IPC.uninstall, packageName),
  listCheckpoints: () => ipcRenderer.invoke(RECOVERY_IPC.listCheckpoints),
  inspectCheckpoint: (slotId: string) => ipcRenderer.invoke(RECOVERY_IPC.inspectCheckpoint, slotId),
  listProfiles: () => ipcRenderer.invoke(RECOVERY_IPC.listProfiles),
})
