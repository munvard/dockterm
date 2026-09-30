import { sanitizePasteText, wrapBracketedPaste } from '../components/terminal/terminalSelection'
import {
  buildImagePaste,
  buildPromptText,
  isSafePath,
  maxImageMarker,
  newImageMarkers,
  type Attachment,
  type ComposerPlatform,
  type PastedChip
} from '../components/chat/composerText'

/**
 * The composer's Send algorithm (spec 2026-09-29-composer-spec.md), with every
 * side effect injected so the order and timing are unit-tested.
 *
 * 1. Images: their own bracketed paste, then wait for `[Image #` to show up in
 *    the pane (Claude reads the files at paste time) before anything else.
 * 2. Text: chips expanded, leading space if images went first, file refs last.
 * 3. sendPrompt (paste, then Enter ~70 ms later).
 */
export interface SendDeps {
  bracketedPaste: (leafId: string) => boolean
  write: (leafId: string, text: string) => boolean
  visibleText: (leafId: string) => string
  /** What is typed in Claude's own input box right now: '' empty, null when no box is on screen. */
  claudeInput: (leafId: string) => string | null
  sendPrompt: (leafId: string, text: string) => Promise<boolean>
  /** A fresh check that Claude is the foreground program of the pane (fail closed). */
  isClaude: (leafId: string) => Promise<boolean>
  sleep: (ms: number) => Promise<void>
  now: () => number
  warn: (message: string) => void
}

export interface ComposedInput {
  text: string
  chips: PastedChip[]
  attachments: Attachment[]
  /** The pane's project root, for `@relative` file refs. */
  root: string | null
  platform: ComposerPlatform
}

export const CLEAR_TRIES = 5
export const CLEAR_WAIT_MS = 60
const CTRL_U = '\x15'

/**
 * Make Claude's input box empty before the app types into it, so a prompt is never
 * appended to leftover text. Ctrl+U clears one line (a wrapped draft needs several
 * presses), so it is sent, re-read and repeated up to CLEAR_TRIES times. A screen
 * with no box (null) is not blocked. Resolves false when the box will not clear.
 */
export async function clearClaudeInputWith(
  deps: Pick<SendDeps, 'write' | 'claudeInput' | 'sleep'>,
  leafId: string
): Promise<boolean> {
  const empty = (): boolean => {
    const t = deps.claudeInput(leafId)
    return t === null || t.trim() === ''
  }
  if (empty()) return true
  for (let i = 0; i < CLEAR_TRIES; i++) {
    if (!deps.write(leafId, CTRL_U)) return false
    await deps.sleep(CLEAR_WAIT_MS)
    if (empty()) return true
  }
  return false
}

export const IMAGE_POLL_MS = 60
export const IMAGE_TIMEOUT_MS = 4000

export async function sendComposedWith(
  deps: SendDeps,
  leafId: string,
  input: ComposedInput
): Promise<boolean> {
  const images = input.attachments.filter((a) => a.kind === 'image' && isSafePath(a.path))
  const skipped = input.attachments.filter((a) => a.kind === 'image').length - images.length
  if (skipped > 0) deps.warn('An image with an unusual file name was not sent.')
  const files = input.attachments.filter((a) => a.kind !== 'image')

  if (!(await deps.isClaude(leafId))) return false

  if (!(await clearClaudeInputWith(deps, leafId))) {
    deps.warn('Claude’s input box has text that would not clear. Clear it in the terminal, then send again.')
    return false
  }

  if (images.length > 0) {
    const baseMax = maxImageMarker(deps.visibleText(leafId))
    const bracketed = deps.bracketedPaste(leafId)
    const payload = buildImagePaste(
      images.map((i) => i.path),
      input.platform,
      bracketed
    )
    if (!deps.write(leafId, bracketed ? wrapBracketedPaste(payload) : sanitizePasteText(payload))) return false

    const started = deps.now()
    let seen = false
    while (deps.now() - started < IMAGE_TIMEOUT_MS) {
      await deps.sleep(IMAGE_POLL_MS)
      if (newImageMarkers(deps.visibleText(leafId), baseMax) >= images.length) {
        seen = true
        break
      }
    }
    if (!seen) deps.warn('Claude did not confirm the image. Sending the message anyway.')
  }

  const text = buildPromptText({
    text: input.text,
    chips: input.chips,
    files,
    root: input.root,
    platform: input.platform,
    hadImages: images.length > 0
  })
  if (!text.trim() && images.length === 0) return false
  if (!(await deps.isClaude(leafId))) return false
  return deps.sendPrompt(leafId, text || ' ')
}
