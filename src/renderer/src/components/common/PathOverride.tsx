import { useEffect, useRef, useState } from 'react'

/** A small "custom folder/file" override row used inside the Skills / Agents /
 * MCP panels, so each config location lives next to what it configures.
 *
 * The input keeps its own draft so typing feels instant — it only commits
 * (round-trips through the async settings IPC) on blur or Enter, instead of
 * firing on every keystroke, which used to fight the caret as the confirmed
 * value echoed back mid-edit. */
export function PathOverride({
  label,
  value,
  placeholder = 'default locations',
  pickDir = true,
  onChange
}: {
  label: string
  value: string
  placeholder?: string
  pickDir?: boolean
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])

  const commit = (): void => {
    editing.current = false
    if (draft !== value) onChange(draft)
  }

  const browse = async (): Promise<void> => {
    const res = await window.dockterm.invoke('project:openDialog', undefined)
    if (res.ok && 'path' in res.value) {
      setDraft(res.value.path)
      onChange(res.value.path)
    }
  }

  return (
    <div className="pathoverride">
      <span className="pathoverride__label">{label}</span>
      <div className="pathoverride__row">
        <input
          className="settings-input"
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={() => {
            editing.current = true
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              editing.current = false
              setDraft(value)
              e.currentTarget.blur()
            }
          }}
        />
        {pickDir && (
          <button className="btn btn--ghost btn--sm" onClick={() => void browse()}>
            Browse
          </button>
        )}
      </div>
    </div>
  )
}
