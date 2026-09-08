import assert from 'node:assert/strict'
import { join, win32 } from 'node:path'
import test from 'node:test'

import { DESKTOP_APP_NAME, DESKTOP_APP_USER_MODEL_ID, DESKTOP_TOAST_ACTIVATOR_CLSID, DESKTOP_USER_DATA_DIR, resolveDesktopRuntimeDir, resolveDesktopUserDataDir } from '../src/app-identity.js'

test('展示名、进程安装目录和用户数据目录都使用 DSH My Desktop', () => {
  assert.equal(DESKTOP_APP_NAME, 'DSH My Desktop')
  assert.equal(DESKTOP_USER_DATA_DIR, 'DSH My Desktop')
  assert.equal(DESKTOP_APP_USER_MODEL_ID, 'ai.micheng.deepseekHarnessDesktop')
  assert.match(DESKTOP_TOAST_ACTIVATOR_CLSID, /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/)
  assert.equal(resolveDesktopUserDataDir('C:\\Users\\demo\\AppData\\Roaming'), join('C:\\Users\\demo\\AppData\\Roaming', 'DSH My Desktop'))
})

test('打包后官方运行时优先放安装目录，而不是 C 盘 AppData', () => {
  const userData = 'C:\\Users\\demo\\AppData\\Roaming\\DSH My Desktop'
  assert.equal(
    resolveDesktopRuntimeDir(userData, {
      isPackaged: true,
      execPath: 'D:\\Apps\\DSH My Desktop\\DSH My Desktop.exe',
      platform: 'win32',
      canWrite: () => true,
    }),
    win32.join('D:\\Apps\\DSH My Desktop', 'dsh-runtime'),
  )
})

test('安装目录不可写时才回退到用户数据目录', () => {
  const userData = 'C:\\Users\\demo\\AppData\\Roaming\\DSH My Desktop'
  assert.equal(
    resolveDesktopRuntimeDir(userData, {
      isPackaged: true,
      execPath: 'C:\\Program Files\\DSH My Desktop\\DSH My Desktop.exe',
      platform: 'win32',
      canWrite: () => false,
    }),
    join(userData, 'dsh-runtime'),
  )
})

test('macOS 打包态始终把可变运行时写到 userData，避免修改签名应用包', () => {
  const userData = '/Users/demo/Library/Application Support/DSH My Desktop'
  assert.equal(
    resolveDesktopRuntimeDir(userData, {
      isPackaged: true,
      execPath: '/Applications/DSH My Desktop.app/Contents/MacOS/DSH My Desktop',
      platform: 'darwin',
      canWrite: () => true,
    }),
    join(userData, 'dsh-runtime'),
  )
})
