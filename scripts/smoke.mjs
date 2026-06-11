// Standalone runtime smoke check for the terminal hard gate (M1).
// Launches the *built* app, types a command into the terminal, and screenshots
// the result so a human (or Claude) can confirm the shell actually responds.
import { _electron as electron } from 'playwright'
import { setTimeout as sleep } from 'node:timers/promises'

const CWD = 'E:\\dockterm'
const SHOT = process.env.SMOKE_SHOT ?? 'E:\\dt-tmp\\smoke.png'

const app = await electron.launch({ args: ['.'], cwd: CWD })
try {
  const win = await app.firstWindow()
  const title = await win.title()
  console.log('WINDOW_TITLE=' + title)

  await win.waitForSelector('.xterm', { timeout: 20000 })
  await sleep(1800) // let the shell print its first prompt

  await win.click('.xterm-screen').catch(() => {})
  await win.keyboard.type('echo DOCKTERM_SMOKE_OK')
  await win.keyboard.press('Enter')
  await sleep(1500)

  await win.screenshot({ path: SHOT })
  console.log('SCREENSHOT=' + SHOT)
  console.log('SMOKE_DONE')
} finally {
  await app.close()
}
