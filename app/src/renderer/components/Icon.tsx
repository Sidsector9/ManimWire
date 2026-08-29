// Inline 12-13px icons from the handoff: explicit strokes, no icon font.

const PATHS: Record<string, React.ReactNode> = {
  stacked: (
    <>
      <rect x="1.5" y="1.5" width="10" height="4" rx="1" />
      <rect x="1.5" y="7.5" width="10" height="4" rx="1" />
    </>
  ),
  side: (
    <>
      <rect x="1.5" y="1.5" width="4" height="10" rx="1" />
      <rect x="7.5" y="1.5" width="4" height="10" rx="1" />
    </>
  ),
  canvas: (
    <>
      <rect x="1.5" y="2.5" width="10" height="8" rx="1" />
      <circle cx="6.5" cy="6.5" r="1.8" />
    </>
  ),
  code: (
    <>
      <path d="M4.5 3.5 1.5 6.5l3 3" />
      <path d="M8.5 3.5l3 3-3 3" />
    </>
  ),
  gear: (
    <>
      <circle cx="6.5" cy="6.5" r="2" />
      <path d="M6.5 1v1.6M6.5 10.4V12M1 6.5h1.6M10.4 6.5H12M2.6 2.6l1.2 1.2M9.2 9.2l1.2 1.2M2.6 10.4l1.2-1.2M9.2 3.8l1.2-1.2" />
    </>
  ),
  download: (
    <>
      <path d="M6.5 1.5v7M3.5 5.5l3 3 3-3" />
      <path d="M1.5 9.5v2h10v-2" />
    </>
  ),
  play: <path d="M3 1.5v10l8-5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="2.5" y="1.5" width="3" height="10" fill="currentColor" stroke="none" />
      <rect x="7.5" y="1.5" width="3" height="10" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="2.5" y="2.5" width="8" height="8" fill="currentColor" stroke="none" />,
  previous: (
    <>
      <path d="M2.5 1.5v10" />
      <path d="M10.5 1.5v10l-7-5z" fill="currentColor" stroke="none" />
    </>
  ),
  next: (
    <>
      <path d="M10.5 1.5v10" />
      <path d="M2.5 1.5v10l7-5z" fill="currentColor" stroke="none" />
    </>
  ),
  loop: (
    <>
      <path d="M2 5.5a4.5 4.5 0 0 1 8.2-2.6" />
      <path d="M10.5 1.5v2h-2" />
      <path d="M11 7.5a4.5 4.5 0 0 1-8.2 2.6" />
      <path d="M2.5 11.5v-2h2" />
    </>
  ),
  socket: <circle cx="6.5" cy="6.5" r="3" />,
  copy: (
    <>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" />
      <path d="M2.5 8.5v-6h6" />
    </>
  )
}

export function Icon({ name, size = 13 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
