import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { getSettings, saveSettings, type Settings } from '@/api/settings'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SectionHeader } from '@/settings/sections/Section'
import { openSettings } from '@/settings/store'

function ServerNote({ name }: { name: string }) {
  return (
    <p className="text-muted-foreground text-[13px]">
      Set by the server with <code className="font-mono text-[12px]">{name}</code>.
    </p>
  )
}

function TaskSourceForm({ settings }: { settings: Settings }) {
  const providerLocked = settings.locked.includes('provider')
  const urlLocked = settings.locked.includes('jira_base_url')
  const queryClient = useQueryClient()
  const [provider, setProvider] = useState(settings.provider)
  const [baseUrl, setBaseUrl] = useState(settings.jira.base_url ?? '')
  const [intervalS, setIntervalS] = useState(String(settings.refresh_interval_s))

  const save = useMutation({
    mutationFn: () =>
      saveSettings({
        provider,
        refresh_interval_s: Number(intervalS),
        ...(baseUrl.trim() && { jira: { base_url: baseUrl.trim() } }),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings'], saved)
      // Cards resolve through the selected provider, so re-read open boards.
      void queryClient.invalidateQueries({ queryKey: ['board'] })
      void queryClient.invalidateQueries({ queryKey: ['refresh'] })
      void queryClient.invalidateQueries({ queryKey: ['tracker'] })
      toast.success('Settings saved')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium">Source</legend>
        <RadioGroup
          value={provider}
          onValueChange={(value) => setProvider(value as Settings['provider'])}
          disabled={providerLocked}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="demo" id="provider-demo" />
            <Label htmlFor="provider-demo">Demo tasks (DEMO-1 to DEMO-12)</Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="jira" id="provider-jira" />
            <Label htmlFor="provider-jira">Jira Cloud, Data Center or Server</Label>
          </div>
        </RadioGroup>
        {providerLocked && <ServerNote name="TIKO_TRACKER" />}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="refresh-interval">Refresh every, seconds</Label>
        <Input
          id="refresh-interval"
          type="number"
          min={30}
          max={300}
          step={5}
          required
          value={intervalS}
          onChange={(event) => setIntervalS(event.target.value)}
          className="w-28"
        />
        <p className="text-muted-foreground text-[13px]">
          30 to 300. One request to Jira per open board each time.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">Jira</legend>
        {!settings.secret_key_configured && (
          <Alert>
            <AlertDescription>
              Set TIKO_SECRET_KEY in .env and restart tiko so people can store their tokens.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="jira-url">Base URL</Label>
          <Input
            id="jira-url"
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://jira.example.com"
            autoComplete="off"
            spellCheck={false}
            readOnly={urlLocked}
            disabled={urlLocked}
          />
          {urlLocked && <ServerNote name="JIRA_BASE_URL" />}
          {settings.jira.kind && baseUrl.trim() === settings.jira.base_url && (
            <p className="text-muted-foreground text-[13px]">
              {settings.jira.kind === 'cloud' ? 'Jira Cloud' : 'Jira Data Center or Server'}, as the
              site reports.
            </p>
          )}
        </div>
        <p className="text-muted-foreground text-[13px]">
          Each person connects their own token in{' '}
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => openSettings('tracker')}
          >
            My tracker
          </button>
          , so cards show what their own Jira access allows. Moving to another URL asks everyone to
          enter their token again.
        </p>
      </fieldset>

      {save.isError && (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  )
}

export function TaskSource() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Task source"
        description="Where cards get their task data, for everyone on this tiko."
      />
      {settings.isPending && <p className="text-muted-foreground">Loading…</p>}
      {settings.isError && (
        <Alert variant="destructive">
          <AlertDescription>{settings.error.message}</AlertDescription>
        </Alert>
      )}
      {settings.isSuccess && <TaskSourceForm settings={settings.data} />}
    </div>
  )
}
