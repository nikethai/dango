import { useEffect, useState } from 'react'

/**
 * Custom hook for tracking real-time elapsed time for thinking processes
 * Handles cleanup on component unmount and provides smooth 100ms updates
 * @param startTime - The timestamp when thinking started (in milliseconds)
 * @param isActive - Whether the thinking process is currently active
 * @returns The elapsed time in milliseconds
 */
export function useThinkingTimer(startTime: number | undefined, isActive: boolean): number {
  const [elapsedTime, setElapsedTime] = useState(0)

  useEffect(() => {
    if (!isActive || !startTime) {
      setElapsedTime(0)
      return
    }

    // Whole-second ticks only — 100ms updates made live labels jittery (not product-grade).
    const updateElapsed = () => {
      const ms = Date.now() - startTime
      // Floor to 250ms buckets so React only re-renders a few times per second.
      setElapsedTime(Math.floor(ms / 250) * 250)
    }

    updateElapsed()
    const interval = setInterval(updateElapsed, 250)

    return () => clearInterval(interval)
  }, [startTime, isActive])

  return elapsedTime
}

/**
 * Format elapsed time in a human-readable format
 * @param milliseconds - Time in milliseconds
 * @returns Formatted time string (e.g., "3.2s", "15.7s", "1m 23s")
 */
export function formatElapsedTime(milliseconds: number): string {
  if (milliseconds < 1000) {
    return '0.0s'
  }

  const totalSeconds = milliseconds / 1000

  if (totalSeconds < 60) {
    // Show one decimal place for seconds under 60
    return `${totalSeconds.toFixed(1)}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = Math.floor(totalSeconds % 60)

  if (remainingSeconds === 0) {
    return `${minutes}m`
  }

  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Format elapsed time in a humanized, natural language format
 * @param milliseconds - Time in milliseconds
 * @returns Humanized time string (e.g., "less than a second", "12 seconds", "1 minute 23 seconds")
 */
export function formatHumanizedDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return 'less than a second'
  }

  const totalSeconds = Math.round(milliseconds / 1000)

  if (totalSeconds === 1) {
    return '1 second'
  }

  if (totalSeconds < 60) {
    return `${totalSeconds} seconds`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  const minuteStr = minutes === 1 ? '1 minute' : `${minutes} minutes`

  if (remainingSeconds === 0) {
    return minuteStr
  }

  const secondStr = remainingSeconds === 1 ? '1 second' : `${remainingSeconds} seconds`
  return `${minuteStr} ${secondStr}`
}

/**
 * Compact duration for mock `.worked` labels (Grok DNA): "4s", "1m 23s"
 */
export function formatWorkedDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return '<1s'
  }

  const totalSeconds = Math.round(milliseconds / 1000)

  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  if (remainingSeconds === 0) {
    return `${minutes}m`
  }

  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Spaced duration for Dango thinking/plan labels: "12 s", "1 m 12 s". Never below "1 s".
 * Units are not translated, matching formatWorkedDuration.
 */
export function formatDangoDuration(milliseconds: number): string {
  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000))

  if (totalSeconds < 60) {
    return `${totalSeconds} s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60

  return remainingSeconds === 0 ? `${minutes} m` : `${minutes} m ${remainingSeconds} s`
}
