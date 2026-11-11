import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircleIcon, CloseIcon, StopIcon } from './icons';
import { cx, focusRing, transition } from './styles';

type ToastTone = 'success' | 'error' | 'neutral';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });

/** Non-blocking notices (saved, approved, copied, network error): stacked bottom-right, gone after 4 s, never steal focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const show = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = nextId.current++;
      setItems((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(
        () => {
          dismiss(id);
        },
        toast.tone === 'error' ? 7000 : 4000,
      );
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full animate-enter items-start gap-3 rounded-panel border border-line bg-raised px-4 py-3 text-body text-ink-1 shadow-lg"
          >
            <span
              className={cx(
                'mt-0.5',
                item.tone === 'error'
                  ? 'text-risk-text'
                  : item.tone === 'success'
                    ? 'text-evid'
                    : 'text-ink-3',
              )}
            >
              {item.tone === 'error' ? <StopIcon /> : <CheckCircleIcon />}
            </span>
            <p className="min-w-0 flex-1">{item.message}</p>
            {item.action !== undefined ? (
              <button
                type="button"
                className={cx(
                  'cursor-pointer rounded-sm font-medium text-brand hover:underline',
                  focusRing,
                )}
                onClick={() => {
                  item.action?.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Fechar aviso"
              className={cx(
                '-mr-1 cursor-pointer rounded-sm text-ink-3 hover:text-ink-1',
                transition,
                focusRing,
              )}
              onClick={() => {
                dismiss(item.id);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastApi => useContext(ToastContext);
