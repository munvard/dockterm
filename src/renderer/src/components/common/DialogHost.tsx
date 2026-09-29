import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import {
  useDialogStore,
  type ConfirmOptions,
  type PromptOptions
} from '../../state/useDialogStore'

function ConfirmView({
  state,
  onResolve
}: {
  state: ConfirmOptions
  onResolve: (value: boolean) => void
}) {
  return (
    <Modal onClose={() => onResolve(false)}>
      <div className="dialog">
        <div className="dialog__title">{state.title}</div>
        <div className="dialog__message">{state.message}</div>
        {state.detail && <div className="dialog__detail">{state.detail}</div>}
        {state.command && <code className="dialog__command">{state.command}</code>}
        <div className="dialog__actions">
          <button className="btn btn--ghost btn--sm" onClick={() => onResolve(false)}>
            {state.cancelLabel ?? 'Cancel'}
          </button>
          <button
            className={`btn btn--sm ${state.danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={() => onResolve(true)}
          >
            {state.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function PromptView({
  state,
  onResolve
}: {
  state: PromptOptions
  onResolve: (value: string | null) => void
}) {
  const [value, setValue] = useState(state.initial ?? '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    // An optional field (allowEmpty) can be submitted blank — resolve to ''
    // rather than null, which the caller reserves for an actual Cancel/Esc.
    onResolve(state.allowEmpty ? trimmed : trimmed || null)
  }

  return (
    <Modal onClose={() => onResolve(null)}>
      <div className="dialog">
        <div className="dialog__title">{state.title}</div>
        {state.label && <label className="dialog__label">{state.label}</label>}
        <input
          ref={inputRef}
          className="dialog__input"
          value={value}
          placeholder={state.placeholder}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className="dialog__actions">
          <button className="btn btn--ghost btn--sm" onClick={() => onResolve(null)}>
            Cancel
          </button>
          <button className="btn btn--primary btn--sm" onClick={submit}>
            {state.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function DialogHost() {
  const confirmState = useDialogStore((s) => s.confirmState)
  const promptState = useDialogStore((s) => s.promptState)
  const resolveConfirm = useDialogStore((s) => s.resolveConfirm)
  const resolvePrompt = useDialogStore((s) => s.resolvePrompt)

  return (
    <>
      {confirmState && <ConfirmView state={confirmState} onResolve={resolveConfirm} />}
      {promptState && <PromptView state={promptState} onResolve={resolvePrompt} />}
    </>
  )
}
