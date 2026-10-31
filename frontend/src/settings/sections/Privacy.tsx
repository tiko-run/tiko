import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { getPrivacy, savePrivacy } from '@/api/privacy'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/toast'
import { Group, SectionHeader } from '@/settings/sections/Section'
import { Scroller } from '@/components/Scroller'

const USAGE_STATS_GUIDE = 'https://docs.tiko.run/privacy/'

export function Privacy() {
  const queryClient = useQueryClient()
  const privacy = useQuery({ queryKey: ['privacy'], queryFn: getPrivacy })
  const [shown, setShown] = useState(false)
  const save = useMutation({
    mutationFn: savePrivacy,
    onSuccess: (saved) => queryClient.setQueryData(['privacy'], saved),
    onError: toastError,
  })
  const locked = privacy.data?.locked.includes('usage_stats') ?? false
  const errorsLocked = privacy.data?.locked.includes('error_reports') ?? false
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Privacy" description="What this tiko sends about itself." />
      <Group title="Usage stats">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="usage-stats">Send daily usage counts</Label>
          <Switch
            id="usage-stats"
            checked={privacy.data?.usage_stats ?? false}
            disabled={!privacy.data || locked || save.isPending}
            onCheckedChange={(on) => save.mutate({ usage_stats: on })}
          />
        </div>
        <p className="text-muted-foreground text-[13px]">
          Once a day: the version, how tiko runs, the kinds of trackers and the number of people and
          boards as ranges. No names, board contents, tasks or addresses. It shows us how many
          instances run and what to support first.{' '}
          <a
            className="text-foreground underline underline-offset-2"
            href={USAGE_STATS_GUIDE}
            target="_blank"
            rel="noreferrer"
          >
            Every field
          </a>
        </p>
        {locked && (
          <p className="text-muted-foreground text-[13px]">
            Set by the server with <code className="font-mono text-[12px]">TIKO_USAGE_STATS</code>.
          </p>
        )}
        <div>
          <Button variant="outline" size="sm" onClick={() => setShown((open) => !open)}>
            {shown ? 'Hide what is sent' : 'Show what is sent'}
          </Button>
        </div>
        {shown && privacy.data && (
          <Scroller className="bg-muted rounded-md">
            <pre aria-label="Next ping" className="p-3 font-mono text-[12px]">
              {JSON.stringify(privacy.data.next_ping, null, 2)}
            </pre>
          </Scroller>
        )}
      </Group>
      {privacy.data?.error_reports_available && (
        <Group title="Error reports">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="error-reports">Send error reports</Label>
            <Switch
              id="error-reports"
              checked={privacy.data.error_reports}
              disabled={errorsLocked || save.isPending}
              onCheckedChange={(on) => save.mutate({ error_reports: on })}
            />
          </div>
          <p className="text-muted-foreground text-[13px]">
            When something breaks: the error type, the lines of tiko's code it came through and the
            version. No error text, addresses, people or board contents. Open pages start or stop
            sending after a reload.{' '}
            <a
              className="text-foreground underline underline-offset-2"
              href={USAGE_STATS_GUIDE + '#error-reports'}
              target="_blank"
              rel="noreferrer"
            >
              What is sent
            </a>
          </p>
          {errorsLocked && (
            <p className="text-muted-foreground text-[13px]">
              Set by the server with{' '}
              <code className="font-mono text-[12px]">TIKO_ERROR_REPORTS</code>.
            </p>
          )}
        </Group>
      )}
    </div>
  )
}
