import type { SVGProps } from 'react';

/** Ícones decorativos (o significado está sempre no texto ou no nome acessível do botão). Grade 20px, traço 1,75. */
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
      className="size-[1.125em] shrink-0"
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
export const ChevronRightIcon = () => (
  <Icon>
    <path d="m8 5 5 5-5 5" />
  </Icon>
);
export const ChevronLeftIcon = () => (
  <Icon>
    <path d="m12 5-5 5 5 5" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M10 4v12M4 10h12" />
  </Icon>
);
export const HomeIcon = () => (
  <Icon>
    <path d="M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z" />
  </Icon>
);
export const BriefcaseIcon = () => (
  <Icon>
    <rect x="3" y="6" width="14" height="10.5" rx="1.5" />
    <path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h3A1.5 1.5 0 0 1 13 4.5V6M3 10.5h14" />
  </Icon>
);
export const DocumentIcon = () => (
  <Icon>
    <path d="M5.5 2.5h6l3.5 3.5v10.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z" />
    <path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13.2 13.2 3.8 3.8" />
  </Icon>
);
export const SunIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="3.5" />
    <path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1" />
  </Icon>
);
export const MoonIcon = () => (
  <Icon>
    <path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z" />
  </Icon>
);
export const MonitorIcon = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
    <path d="M7 17h6M10 13.5V17" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);
export const CheckCircleIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7.25" />
    <path d="m7 10.2 2.2 2.2L13.3 8" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon>
    <path d="M10 3 2.5 16.5h15z" />
    <path d="M10 8.5v3.5M10 14.5v.01" />
  </Icon>
);
export const StopIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M5 15 15 5" />
  </Icon>
);
export const InfoIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M10 9v4.5M10 6.5v.01" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="m5 5 10 10M15 5 5 15" />
  </Icon>
);
export const MenuIcon = () => (
  <Icon>
    <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
  </Icon>
);
export const SidebarIcon = () => (
  <Icon>
    <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
    <path d="M7.5 3.5v13" />
  </Icon>
);
export const CopyIcon = () => (
  <Icon>
    <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
    <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6A1.5 1.5 0 0 0 5.5 12.5H7" />
  </Icon>
);
export const HistoryIcon = () => (
  <Icon>
    <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6L3.5 7.3M3.5 3.5v3.8h3.8" />
    <path d="M10 6.5V10l2.5 1.5" />
  </Icon>
);
export const LogoutIcon = () => (
  <Icon>
    <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
  </Icon>
);
export const UserIcon = () => (
  <Icon>
    <circle cx="10" cy="7" r="3.5" />
    <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
  </Icon>
);
export const SparkIcon = () => (
  <Icon>
    <path d="M10 2.5v4M10 13.5v4M2.5 10h4M13.5 10h4M5 5l2.3 2.3M12.7 12.7 15 15M5 15l2.3-2.3M12.7 7.3 15 5" />
  </Icon>
);
export const ExternalIcon = () => (
  <Icon>
    <path d="M11 3.5h5.5V9M16.5 3.5 9.5 10.5M14 11.5V16a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 4 16V7a.5.5 0 0 1 .5-.5H9" />
  </Icon>
);
export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
    <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7" />
  </Icon>
);
