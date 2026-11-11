import type { SVGProps } from 'react';

/** Ícones decorativos (o significado está sempre no texto ou no nome acessível do botão). */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export const MoreIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <circle cx="4.5" cy="10" r="1.6" />
    <circle cx="10" cy="10" r="1.6" />
    <circle cx="15.5" cy="10" r="1.6" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 16h12" />
  </Icon>
);

export const ChevronDownIcon = () => (
  <Icon>
    <path d="m5 8 5 5 5-5" />
  </Icon>
);
