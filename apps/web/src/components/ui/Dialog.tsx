import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './icons';
import { IconButton } from './Button';
import { cx } from './styles';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: focus moves inside and is trapped there, Esc or a click on the backdrop closes it, and focus returns
 * to what had it before. `initialFocus` picks the first element to focus (default: the first focusable one).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  placement = 'center',
  initialFocus,
  hideTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  placement?: 'center' | 'top';
  initialFocus?: RefObject<HTMLElement | null>;
  hideTitle?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const target = initialFocus?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? panelRef.current)?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, initialFocus]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    // The backdrop click is a mouse shortcut; Esc and the close button are the keyboard paths.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={cx(
        'fixed inset-0 z-40 flex justify-center bg-scrim p-4 backdrop-blur-[2px]',
        placement === 'top' ? 'items-start pt-[12vh]' : 'items-center',
      )}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* Esc and the Tab trap belong to the dialog itself. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          'flex max-h-[80vh] w-full animate-enter flex-col overflow-hidden rounded-panel border border-line bg-raised text-ink-1 shadow-lg outline-none',
          size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <div
          className={cx(
            'flex items-start justify-between gap-4 px-5 pt-4',
            hideTitle ? 'sr-only' : '',
          )}
        >
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-section font-semibold">
              {title}
            </h2>
            {description !== undefined ? (
              <div id={descriptionId} className="text-body text-ink-2">
                {description}
              </div>
            ) : null}
          </div>
          {hideTitle ? null : (
            <IconButton label="Fechar" icon={<CloseIcon />} size="sm" onClick={onClose} />
          )}
        </div>
        <div className={cx('min-h-0 flex-1 overflow-y-auto', hideTitle ? '' : 'px-5 py-4')}>
          {children}
        </div>
        {footer !== undefined ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-sunken/60 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
