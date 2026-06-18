/** A small "custom folder/file" override row used inside the Skills / Agents /
 * MCP panels, so each config location lives next to what it configures. */
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
  const browse = async (): Promise<void> => {
    const res = await window.dockterm.invoke('project:openDialog', undefined)
    if (res.ok && 'path' in res.value) onChange(res.value.path)
  }
  return (
    <div className="pathoverride">
      <span className="pathoverride__label">{label}</span>
      <div className="pathoverride__row">
        <input
          className="settings-input"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
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
