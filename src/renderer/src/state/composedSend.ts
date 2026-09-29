import { sanitizePasteText, wrapBracketedPaste } from '../components/terminal/terminalSelection'
import {
  buildImagePaste,
  buildPromptText,
  isSafePath,
  countImageMarkers,
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

  if (images.length > 0) {
    const before = countImageMarkers(deps.visibleText(leafId))
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
      if (countImageMarkers(deps.visibleText(leafId)) >= before + images.length) {
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
