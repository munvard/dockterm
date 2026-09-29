import { useEffect, useRef } from 'react'

export interface MenuItem {
  key: string
  label: string
  hint?: string
  badge?: string
}

/** The `/` command list and the `@` file list above the composer. Mouse-down is
 * swallowed so the textarea keeps focus and its caret. */
export function ComposerMenu({
  items,
  index,
  onPick,
  onHover
}: {
  items: MenuItem[]
  index: number
  onPick: (i: number) => void
  onHover: (i: number) => void
}): React.ReactElement {
  const onRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    onRef.current?.scrollIntoView({ block: 'nearest' })
  }, [index, items])

  return (
    <div className="cmenu" role="listbox">
      {items.map((it, i) => (
        <div
          key={it.key}
          ref={i === index ? onRef : undefined}
          role="option"
          aria-selected={i === index}
          className={`cmenu__item${i === index ? ' cmenu__item--on' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(i)
          }}
          onMouseEnter={() => onHover(i)}
        >
          <span className="cmenu__label">{it.label}</span>
          {it.badge && <span className="cmenu__badge">{it.badge}</span>}
          {it.hint && <span className="cmenu__hint">{it.hint}</span>}
        </div>
      ))}
    </div>
  )
}

export function ComposerMenuNote({ children }: { children: string }): React.ReactElement {
  return <div className="cmenu cmenu--note">{children}</div>
}
