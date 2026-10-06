import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  spark: <path d="M12 2.5 L14 9.5 L21 12 L14 14.5 L12 21.5 L10 14.5 L3 12 L10 9.5 Z" fill="currentColor" stroke="none" />,
  plus: <path d="M12 5.5 V18.5 M5.5 12 H18.5" strokeWidth={2.4} />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.3 15.3 L20.5 20.5" /></>,
  send: <path d="M21 3 L10.5 13.5 M21 3 L14.5 21 L10.5 13.5 L3 9.5 Z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />,
  play: <path d="M8.5 5.5 L18.5 12 L8.5 18.5 Z" fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />,
  pause: <><rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" /></>,
  download: <path d="M12 3.5 V15 M7.5 10.8 L12 15.3 L16.5 10.8 M4.5 20 H19.5" />,
  import: <path d="M12 3.5 V13.5 M8 9.5 L12 13.5 L16 9.5 M4.5 14.5 V18 A1.5 1.5 0 0 0 6 19.5 H18 A1.5 1.5 0 0 0 19.5 18 V14.5" />,
  close: <path d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" strokeWidth={2.2} />,
  x: <path d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" strokeWidth={2.2} />,
  drag: <><circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" /></>,
  check: <path d="M5 12.5 L9.8 17.3 L19 6.8" strokeWidth={2.4} />,
  dot: <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />,
  back: <path d="M14.5 5 L8 12 L14.5 19" />,
  arrow: <path d="M4 12 H19 M13 6 L19 12 L13 18" />,
  'arrow-left': <path d="M20 12 H5 M11 6 L5 12 L11 18" />,
  library: <><path d="M5.5 3.5 H14 A2 2 0 0 1 16 5.5 V20.5 H7.5 A2 2 0 0 1 5.5 18.5 Z" /><path d="M8.5 3.5 V20.5 M18.5 5.5 H19.5 V20.5 H16" /></>,
  waveform: <path d="M4 10 V14 M8 6.5 V17.5 M12 3.5 V20.5 M16 7.5 V16.5 M20 10.5 V13.5" />,
  chat: <><rect x="3.5" y="4.5" width="17" height="12" rx="2" /><path d="M8.5 16.5 V20 L12.5 16.5" /></>,
  edit: <path d="M16.8 3.9 A2 2 0 0 1 19.6 6.7 L7.5 18.8 L3.5 19.9 L4.6 15.9 Z M14.8 5.9 L18.1 9.2" />,
  undo: <><path d="M8 5 L4 9 L8 13" /><path d="M4 9 H13.5 A6 6 0 0 1 19.5 15 V17" /></>,
  forward: <><path d="M16 5 L20 9 L16 13" /><path d="M20 9 H10.5 A6 6 0 0 0 4.5 15 V17" /></>,
  trash: <path d="M4.5 6.5 H19.5 M9.5 6.5 V4.5 H14.5 V6.5 M6.5 6.5 L7.5 19.5 A1.5 1.5 0 0 0 9 20.9 H15 A1.5 1.5 0 0 0 16.5 19.5 L17.5 6.5 M10 10.5 V16.5 M14 10.5 V16.5" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11 V16.2" /><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8.5 10.5 V7.5 A3.5 3.5 0 0 1 15.5 7.5 V10.5" /><circle cx="12" cy="15.2" r="1.2" fill="currentColor" stroke="none" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8 V5.2 M12 18.8 V21.2 M2.8 12 H5.2 M18.8 12 H21.2 M5.5 5.5 L7.2 7.2 M16.8 16.8 L18.5 18.5 M5.5 18.5 L7.2 16.8 M16.8 7.2 L18.5 5.5" /><circle cx="12" cy="12" r="6.6" /></>,
  palette: <><path d="M12 3.5 A8.5 8.5 0 1 0 12 20.5 C13.4 20.5 13.9 19.5 13.4 18.4 C12.8 17.1 13.6 15.8 15 15.8 H17 A3.5 3.5 0 0 0 20.5 12.3 C20.5 7.4 16.7 3.5 12 3.5 Z" /><circle cx="7.8" cy="11" r="1.2" fill="currentColor" stroke="none" /><circle cx="10.5" cy="7.4" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="7.8" r="1.2" fill="currentColor" stroke="none" /></>,
  music: <><path d="M9 17.5 V5.5 L19 3.5 V15.5" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5 A6.5 6.5 0 0 0 18.5 11.5 M12 18 V20.5" /></>,
  piano: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M8.2 4.5 V19.5 M12 4.5 V19.5 M15.8 4.5 V19.5" /><path d="M7 4.5 V12 H9.4 V4.5 M14.6 4.5 V12 H17 V4.5" fill="currentColor" /></>,
  repeat: <><path d="M17 3.5 L20 6.5 L17 9.5" /><path d="M4 11.5 V10 A3.5 3.5 0 0 1 7.5 6.5 H20" /><path d="M7 20.5 L4 17.5 L7 14.5" /><path d="M20 12.5 V14 A3.5 3.5 0 0 1 16.5 17.5 H4" /></>,
  chip: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3.5 V6.5 M14.5 3.5 V6.5 M9.5 17.5 V20.5 M14.5 17.5 V20.5 M3.5 9.5 H6.5 M3.5 14.5 H6.5 M17.5 9.5 H20.5 M17.5 14.5 H20.5" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12 L19.5 3.5 M16 7 L18.5 9.5 M14 9 L16 11" /></>,
  user: <><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20 A7.5 7.5 0 0 1 19.5 20" /></>,
  plug: <path d="M9 3.5 V8 M15 3.5 V8 M6.5 8 H17.5 V11 A5.5 5.5 0 0 1 12 16.5 A5.5 5.5 0 0 1 6.5 11 Z M12 16.5 V20.5" />,
  file: <><path d="M6.5 3.5 H14 L18.5 8 V20.5 H6.5 Z" /><path d="M14 3.5 V8 H18.5 M9.5 12.5 H15.5 M9.5 16 H15.5" /></>,
  'chevron-down': <path d="M6.5 9.5 L12 15 L17.5 9.5" />,
  folder: <path d="M3.5 6.5 A1.5 1.5 0 0 1 5 5 H9.5 L11.5 7 H19 A1.5 1.5 0 0 1 20.5 8.5 V17.5 A1.5 1.5 0 0 1 19 19 H5 A1.5 1.5 0 0 1 3.5 17.5 Z" />,
}

export default function Icon({ name }: { name: string }) {
  return <span className={`icon icon-${name}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />}</svg>
  </span>
}
