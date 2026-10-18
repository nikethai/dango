type LockManagerLike = { request<T>(name: string, fn: () => Promise<T>): Promise<T> }

/**
 * Runs tasks one at a time under a Web Lock named `lockName`. The lock spans every window of this
 * origin (main and Quick Chat share the IndexedDB rows); without it (tests, old runtimes) the
 * in-window queue is the only guard. A failed task never blocks the ones after it.
 *
 * Do not call the returned function again from inside a task: the nested task waits for the
 * outer one, which waits for it.
 */
export function createLockedQueue(lockName: string): <T>(fn: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks
    return locks ? locks.request(lockName, fn) : fn()
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    const locked = () => withLock(fn)
    const run = queue.then(locked, locked)
    queue = run.catch(() => undefined)
    return run
  }
}
