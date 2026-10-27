import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  text: string
  kind: ToastKind
}

interface ToastContextValue {
  notify: (text: string, kind?: ToastKind) => void
  success: (text: string) => void
  error: (text: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = ++counter.current
      setToasts((list) => [...list.slice(-3), { id, text, kind }])
      window.setTimeout(() => remove(id), kind === 'error' ? 6500 : 4500)
    },
    [remove],
  )

  const value = useMemo(
    () => ({
      notify,
      success: (text: string) => notify(text, 'success'),
      error: (text: string) => notify(text, 'error'),
    }),
    [notify],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.kind}`} role="status">
            <span className="toast__icon">
              {toast.kind === 'success' ? (
                <CheckCircle2 size={18} />
              ) : toast.kind === 'error' ? (
                <TriangleAlert size={18} />
              ) : (
                <Info size={18} />
              )}
            </span>
            <span className="toast__text">{toast.text}</span>
            <button
              type="button"
              className="toast__close"
              aria-label="Закрыть уведомление"
              onClick={() => remove(toast.id)}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast должен использоваться внутри ToastProvider')
  return value
}
