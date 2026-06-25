type Env = Record<string, string | undefined>

/**
 * Ensure the PTY has a UTF-8 character locale so multibyte input (pasted emoji,
 * em-dashes, accents) isn't mangled.
 *
 * On macOS, an app launched from Finder/Dock inherits NO `LANG`/`LC_*`, so the
 * shell and Claude fall back to the C/POSIX locale and misread multibyte UTF-8
 * *input* — while output still renders. Setting `LC_CTYPE=UTF-8` (a valid
 * BSD/macOS value) fixes the encoding without changing the user's language. We
 * only touch it when no UTF-8 locale is already present, and only on darwin
 * (Linux inherits `LANG` from the launching shell; Windows uses ConPTY/UTF-16).
 */
export function ensureUtf8Locale(env: Env, platform: string): Env {
  if (platform !== 'darwin') return env
  const isUtf8 = (v: string | undefined): boolean => !!v && /utf-?8/i.test(v)
  if (isUtf8(env.LC_ALL) || isUtf8(env.LC_CTYPE) || isUtf8(env.LANG)) return env
  env.LC_CTYPE = 'UTF-8'
  return env
}
