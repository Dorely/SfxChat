import { test, expect, type ElectronApplication, type Page, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

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

async function snapshot(app: ElectronApplication) {
  return app.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents()[0]
    return page ? await page.executeJavaScript('window.sfx.snapshot()') : null
  })
}

test('complete creative workbench flow persists assets and protects the renderer boundary', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'sfxchat-e2e-'))
  let running = await launch(profile)
  try {
    const { app, page } = running
    await expect(page.locator('.conversation-row')).toHaveCount(1)
    const conversation = await snapshot(app)
    expect(conversation?.conversations).toHaveLength(1)

    const composer = page.getByLabel('Message SfxChat')
    await composer.fill('Generate two UI chimes')
    await page.getByRole('button', { name: 'Send message' }).click()
    await expect(page.locator('.message-user')).toContainText('Generate two UI chimes')
    await expect.poll(async () => page.locator('.asset-grid .asset-card').count(), { timeout: 30_000 }).toBe(2)
    await expect(page.locator('.message-tool').filter({ hasText: 'Ready:' }).first()).toBeVisible({ timeout: 30_000 })
    const conversationId = conversation?.conversations[0].id as string
    const generatedBoard = (await snapshot(app))?.playground[conversationId] as string[]
    const firstGeneratedId = generatedBoard[0]
    const secondGeneratedId = generatedBoard[1]

    await page.locator('.workspace-tabs button').nth(1).click()
    await expect(page.locator('.playground-grid .asset-card')).toHaveCount(2)
    await mkdir(resolve(root, '.tmp'), { recursive: true })
    await page.screenshot({ path: resolve(root, '.tmp', 'workbench.png'), fullPage: true })

    const orderBefore = await page.locator('.playground-slot .asset-title strong').allTextContents()
    await page.getByRole('button', { name: 'Move candidate right' }).first().click()
    await expect.poll(async () => page.locator('.playground-slot .asset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-asset-id')))).toEqual([secondGeneratedId, firstGeneratedId])
    await page.getByRole('button', { name: 'Remove from playground' }).first().click()
    await expect.poll(async () => (await snapshot(app))?.playground[conversationId]).toEqual([firstGeneratedId])
    await page.locator('.workspace-tabs button').first().click()
    await page.locator(`.asset-card[data-asset-id="${secondGeneratedId}"]`).click()
    await page.getByRole('button', { name: 'Add to playground' }).click()
    await expect.poll(async () => (await snapshot(app))?.playground[conversationId]).toEqual([firstGeneratedId, secondGeneratedId])

    await page.locator('.asset-grid .asset-card').first().click()
    await page.getByRole('button', { name: 'Inspect' }).click()
    const drawer = page.locator('.inspector-drawer')
    await expect(drawer).toBeVisible()
    await drawer.getByLabel('Name').fill('UI Chime Confirmed')
    await drawer.getByLabel('Description').fill('A bright, concise confirmation sound for interface feedback.')
    await drawer.getByLabel('Tags').fill('ui, chime, confirmed')
    await drawer.getByLabel('Collections').fill('interface')
    await drawer.locator('textarea[placeholder="What should change in the next pass?"]').fill('Keep the attack crisp and the tail short.')
    await drawer.getByRole('button', { name: 'Accept' }).click()
    await drawer.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.locator('.asset-grid .asset-title strong').first()).toContainText('UI Chime Confirmed')

    await page.getByLabel('Search library').fill('confirmed')
    await expect(page.locator('.asset-grid .asset-card')).toHaveCount(1)
    await expect(page.locator('.asset-grid .asset-title strong')).toContainText('UI Chime Confirmed')
    await page.getByLabel('Search library').fill('')

    await page.locator('.asset-grid .asset-card').first().click()
    await page.getByRole('button', { name: 'Inspect' }).click()
    await drawer.locator('textarea[placeholder="What should change in the next pass?"]').fill('A shorter, softer revision for menu confirmations.')
    await drawer.getByRole('button', { name: 'Regenerate' }).click()
    await expect.poll(async () => (await snapshot(app))?.assets.length ?? 0, { timeout: 30_000 }).toBe(3)
    const revised = await snapshot(app)
    expect(revised?.assets.some((asset: { parentId: string | null }) => asset.parentId !== null)).toBe(true)
    await drawer.getByRole('button', { name: 'Close inspector' }).click()

    await app.evaluate(({ dialog }, source) => {
      ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    }, fixture)
    await page.getByRole('button', { name: 'Import audio' }).click()
    await expect.poll(async () => page.locator('.asset-grid .asset-card').count(), { timeout: 15_000 }).toBe(4)
    await expect(page.locator('.message-tool').filter({ hasText: 'Imported' }).first()).toBeVisible({ timeout: 15_000 })

    const exportPath = join(profile, 'exported-original.mp3')
    await page.locator('.asset-grid .asset-card').first().click()
    await page.getByRole('button', { name: 'Inspect' }).click()
    await app.evaluate(({ dialog }, destination) => {
      ;(dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: destination })
    }, exportPath)
    await drawer.getByRole('button', { name: 'Export original' }).click()
    await expect.poll(async () => (await stat(exportPath)).size).toBeGreaterThan(0)
    expect(await readFile(exportPath)).toEqual(await readFile(fixture))
    await drawer.getByRole('button', { name: 'Export original' }).click()
    await expect(page.getByRole('alert')).toContainText(/exist|already/i)
    await page.getByRole('button', { name: 'Dismiss error' }).click()
    await drawer.getByRole('button', { name: 'Close inspector' }).click()

    await page.locator('.workspace-tabs button').nth(1).click()
    const orderAtClose = await page.locator('.playground-slot .asset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-asset-id')))
    await expect(page.locator('.playground-slot .asset-card')).toHaveCount(4)
    await running.app.close()

    running = await launch(profile)
    const reopened = running.page
    await expect(reopened.locator('.conversation-row')).toHaveCount(1)
    await expect(reopened.locator('.workspace-tabs button').first()).toContainText('Library')
    await expect(reopened.locator('.asset-grid .asset-title strong').filter({ hasText: 'UI Chime Confirmed' }).first()).toBeVisible()
    await reopened.locator('.workspace-tabs button').nth(1).click()
    await expect.poll(async () => reopened.locator('.playground-slot .asset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-asset-id')))).toEqual(orderAtClose)

    await reopened.locator('.workspace-tabs button').first().click()
    const firstCard = reopened.locator('.asset-grid .asset-card').first()
    const secondCard = reopened.locator('.asset-grid .asset-card').nth(1)
    const firstAudio = firstCard.locator('audio')
    const secondAudio = secondCard.locator('audio')
    await firstCard.getByLabel('Loop').check()
    await secondCard.getByLabel('Loop').check()
    await expect.poll(async () => firstAudio.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThan(0)
    await expect.poll(async () => secondAudio.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThan(0)
    await firstCard.getByRole('button', { name: /Play/ }).click()
    await expect.poll(async () => firstAudio.evaluate((audio: HTMLAudioElement) => !audio.paused)).toBe(true)
    await secondCard.getByRole('button', { name: /Play/ }).click()
    await expect.poll(async () => firstAudio.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true)
    await expect.poll(async () => secondAudio.evaluate((audio: HTMLAudioElement) => !audio.paused)).toBe(true)
    await secondCard.locator('.scrub').evaluate((input) => {
      const range = input as HTMLInputElement
      range.value = '0.1'
      range.dispatchEvent(new Event('input', { bubbles: true }))
      range.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(async () => secondAudio.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0)

    expect(await reopened.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
    const secureStorage = await running.app.evaluate(({ safeStorage }) => {
      const plain = 'sfxchat-e2e-secret'
      if (!safeStorage.isEncryptionAvailable()) return { available: false, roundTrip: '', cipherHasPlaintext: false }
      const cipher = safeStorage.encryptString(plain)
      return { available: true, roundTrip: safeStorage.decryptString(cipher), cipherHasPlaintext: cipher.toString('utf8').includes(plain) }
    })
    expect(secureStorage.available).toBe(true)
    expect(secureStorage.roundTrip).toBe('sfxchat-e2e-secret')
    expect(secureStorage.cipherHasPlaintext).toBe(false)

    await running.app.evaluate(({ shell }) => {
      shell.openPath = async path => { (shell as any).__openedLogPath = path; return '' }
    })
    await reopened.getByRole('button', { name: 'Open settings' }).first().click()
    await reopened.getByRole('button', { name: 'Open diagnostic logs' }).click()
    expect(await running.app.evaluate(({ shell }) => (shell as any).__openedLogPath)).toBe(join(profile, 'logs'))
    const diagnostics = await readFile(join(profile, 'logs', 'diagnostics.jsonl'), 'utf8')
    expect(diagnostics).toContain('generation.completed')
    expect(diagnostics).toContain('chat.request_completed')
    expect(diagnostics).not.toContain('Generate two UI chimes')
  } finally {
    await running.app.close().catch(() => undefined)
    await rm(profile, { recursive: true, force: true })
  }
})
