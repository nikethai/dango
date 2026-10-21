/** Whether the viewer asked for reduced motion (A11Y1 rule 2). False where matchMedia is missing. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The scroll behaviour to use: `behavior` (smooth by default), or an instant jump when reduced motion is on. */
export function motionScrollBehavior(behavior: 'auto' | 'smooth' = 'smooth'): 'auto' | 'smooth' {
  return behavior === 'smooth' && prefersReducedMotion() ? 'auto' : behavior
}
