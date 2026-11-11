import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Spinner } from './Spinner';
import { buttonClasses, cx, type ButtonSize, type ButtonVariant } from './styles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and disables the button while keeping its label (no layout jump). */
  loading?: boolean;
  /** Icon before the label (decorative). */
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : undefined}
      className={cx(buttonClasses(variant, size), className)}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export interface LinkButtonProps extends Omit<LinkProps, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
}

/** A router link that looks like a button (navigation, not an action). */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  icon,
  className = '',
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={cx(buttonClasses(variant, size), className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export interface ExternalLinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ExternalLinkButton({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ExternalLinkButtonProps) {
  return (
    <a className={cx(buttonClasses(variant, size), className)} {...rest}>
      {children}
    </a>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name (also shown as a tooltip). */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        buttonClasses(variant, size),
        size === 'sm' ? 'w-8 px-0 pointer-coarse:w-10' : 'w-9 px-0 pointer-coarse:w-11',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
