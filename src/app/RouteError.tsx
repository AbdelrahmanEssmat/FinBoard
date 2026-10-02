import { useEffect } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import { reportClientError } from '@/app/errorReporting'

/** Shown when a screen crashes: the error is reported and you can reload or go home. */
export function RouteError() {
  const error = useRouteError()
  // after an update, an old screen may ask for a file that no longer exists: a reload fixes it
  const staleChunk = error instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message)

  useEffect(() => {
    if (isRouteErrorResponse(error) && error.status === 404) return
    reportClientError(staleChunk ? 'stale-chunk' : 'screen', error)
    // reload once to pick up the new version (never in a loop)
    if (staleChunk) {
      let reloaded: boolean
      try {
        reloaded = sessionStorage.getItem('finboard-chunk-reload') === '1'
        sessionStorage.setItem('finboard-chunk-reload', '1')
      } catch {
        reloaded = true
      }
      if (!reloaded) window.location.reload()
    }
  }, [error, staleChunk])

  return (
    <div className="flex min-h-app items-center justify-center bg-bg px-6 py-10 pt-safe pb-safe">
      <div className="w-full max-w-sm space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
          <TriangleAlert className="h-6 w-6" />
        </span>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm leading-relaxed text-muted">This screen hit a problem. It has been reported. Your data is safe.</p>
        <div className="flex flex-col gap-2">
          <Button full size="lg" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button full variant="secondary" onClick={() => window.location.assign('/')}>
            Go to the home screen
          </Button>
        </div>
      </div>
    </div>
  )
}
