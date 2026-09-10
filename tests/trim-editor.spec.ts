import { test, expect, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { Snapshot } from '../src/shared/types'

const root = resolve(process.cwd())
const fixture = resolve(root, 'tests', 'fixtures', 'tone.mp3')

type RunningApp = { app: ElectronApplication; page: Page; profile: string }

async function launch(profile: string): Promise<RunningApp> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) as Record<string, string>
  Object.assign(env, { SFXCHAT_TEST_MODE: '1', SFXCHAT_TEST_DATA: profile, SFXCHAT_TEST_AUDIO: fixture })
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.app-shell')).toBeVisible()
  return { app, page, profile }
}

async function snapshot(app: ElectronApplication): Promise<Snapshot | null> {
  return app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents()[0]
    return page ? await page.executeJavaScript('window.sfx.snapshot()') as Snapshot : null
  })
}

test('trim editor analyzes, previews, and persists a derived asset', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sfxchat-trim-e2e-'))
  let running = await launch(profile)
  await mkdir(join(root, '.tmp'), { recursive: true })
  try {
    const { app, page } = running
    await app.evaluate(({ dialog }, source) => {
      ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, fixture)
    await page.getByRole('button', { name: 'Import audio' }).click()
    await expect.poll(async () => page.locator('.asset-grid .asset-card').count()).toBe(1)

    const before = await snapshot(app)
    const original = before?.assets[0]
    expect(original).toBeTruthy()
    await page.locator('.asset-grid .asset-card').first().click()
    await page.getByRole('button', { name: 'Inspect' }).click()
    await page.getByRole('button', { name: 'Trim as new asset' }).click()
    const editor = page.locator('.trim-modal')
    await expect(editor).toBeVisible()
    await expect.poll(async () => editor.locator('.trim-waveform-bar').count()).toBeGreaterThan(0)
    await page.screenshot({ path: join(root, '.tmp', 'trim-editor-standard.png') })
    await page.setViewportSize({ width: 1000, height: 650 })
    await page.screenshot({ path: join(root, '.tmp', 'trim-editor.png') })

    const fullEnd = await editor.locator('.trim-time-labels span').nth(1).textContent()
    expect(fullEnd).toMatch(/0\.300/)
    await editor.getByLabel('In point (s)').fill('0.050')
    await editor.getByLabel('Out point (s)').fill('0.200')
    await editor.getByRole('button', { name: 'Zoom selection' }).click()
    await expect.poll(async () => editor.locator('.trim-time-labels span').first().textContent()).toContain('0.050')
    await expect.poll(async () => editor.locator('.trim-time-labels span').nth(1).textContent()).toContain('0.200')
    await page.screenshot({ path: join(root, '.tmp', 'trim-editor-narrow.png') })
    const startHandle = editor.getByLabel('Trim start in seconds')
    await expect(startHandle).toHaveAttribute('min', /0\.05/)
    await startHandle.focus()
    await startHandle.press('ArrowRight')
    await expect(editor.getByLabel('In point (s)')).toHaveValue('0.051')
    await editor.getByLabel('In point (s)').fill('0.050')

    // Observe real playback from the user-facing button. Keep the tiny fixture looping
    // for the stop-button check; never call audio.play() on the application's behalf.
    await page.evaluate(() => {
      const observations = { starts: 0 }
      ;(window as any).__trimPlayback = observations
      document.addEventListener('playing', event => {
        const audio = event.target
        if (audio instanceof HTMLAudioElement && audio.closest('.trim-preview')) {
          observations.starts += 1
          if (observations.starts === 1) audio.loop = true
        }
      }, true)
    })
    await editor.getByRole('button', { name: 'Play selection', exact: true }).click()
    const preview = editor.locator('audio')
    await expect(preview).toHaveAttribute('src', /^blob:/)
    await expect.poll(async () => preview.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThan(0)
    await expect.poll(async () => preview.evaluate((audio: HTMLAudioElement) => !audio.paused)).toBe(true)
    expect(await preview.evaluate((audio: HTMLAudioElement) => audio.duration)).toBeCloseTo(0.15, 3)
    await editor.getByRole('button', { name: 'Stop selection', exact: true }).click()
    expect(await preview.evaluate((audio: HTMLAudioElement) => ({ paused: audio.paused, time: audio.currentTime }))).toEqual({ paused: true, time: 0 })
    await preview.evaluate((audio: HTMLAudioElement) => { audio.loop = false })
    await editor.getByRole('button', { name: 'Play selection', exact: true }).click()
    await expect.poll(async () => page.evaluate(() => (window as any).__trimPlayback.starts)).toBeGreaterThanOrEqual(2)
    await expect.poll(async () => preview.evaluate((audio: HTMLAudioElement) => audio.ended)).toBe(true)
    await expect(editor.getByRole('button', { name: 'Play selection', exact: true })).toBeEnabled()
    await editor.getByLabel('Fade in (ms)').fill('10')
    await expect(editor.locator('audio')).toHaveCount(0)
    await editor.getByLabel('In point (s)').fill('0.100')
    await editor.getByRole('button', { name: 'Play selection', exact: true }).click()
    await expect.poll(async () => page.evaluate(() => (window as any).__trimPlayback.starts)).toBeGreaterThanOrEqual(3)
    expect(await preview.evaluate((audio: HTMLAudioElement) => audio.duration)).toBeCloseTo(0.1, 3)
    await editor.getByRole('button', { name: 'Save as new asset' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(async () => (await snapshot(app))?.assets.length).toBe(2)

    const after = await snapshot(app)
    const derived = after?.assets.find(asset => asset.id !== original?.id)
    const persistedOriginal = after?.assets.find(asset => asset.id === original?.id)
    expect(derived?.source).toBe('edited')
    expect(derived?.parentId).toBe(original?.id)
    expect(derived?.format).toBe('wav')
    expect(derived?.duration).toBeGreaterThan(0)
    expect(derived?.duration).toBeLessThan(original?.duration || 1)
    expect(derived?.hash).not.toBe(original?.hash)
    expect(persistedOriginal?.hash).toBe(original?.hash)
    await expect(page.locator(`.asset-grid .asset-card[data-asset-id="${derived?.id}"]`)).toHaveClass(/asset-selected/)

    await page.getByRole('button', { name: 'Close inspector' }).click()
    await running.app.close()
    running = await launch(profile)
    await expect(running.page.locator(`.asset-card[data-asset-id="${derived?.id}"]`)).toBeVisible()
  } finally {
    await running.app.close().catch(() => undefined)
    await rm(profile, { recursive: true, force: true })
  }
})
