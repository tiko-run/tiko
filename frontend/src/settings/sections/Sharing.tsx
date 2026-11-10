import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSettings, saveSettings, type SettingsChange } from '@/api/settings'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toastError } from '@/lib/toast'
import { Group, SectionHeader } from '@/settings/sections/Section'

export function Sharing() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const save = useMutation({
    mutationFn: (change: SettingsChange) => saveSettings(change),
    onSuccess: (saved) => queryClient.setQueryData(['settings'], saved),
    onError: toastError,
  })
  const live = settings.data?.api_keys_live
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Sharing" description="How boards can be shown outside this tiko." />
      <Group title="Public links">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="public-links">Board owners can make a public link</Label>
          <Switch
            id="public-links"
            checked={settings.data?.public_links ?? false}
            disabled={!settings.data || save.isPending}
            onCheckedChange={(allowed) => save.mutate({ public_links: allowed })}
          />
        </div>
        <p className="text-muted-foreground text-[13px]">
          Anyone with a board's link can view it without signing in. Tasks from your tracker show
          only their key. Switching this off stops every public link at once.
        </p>
      </Group>
      <Group title="API keys">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="api-keys">Let people make API keys for scripts and AI agents</Label>
          <Switch
            id="api-keys"
            checked={settings.data?.api_keys ?? false}
            disabled={!settings.data || save.isPending}
            onCheckedChange={(allowed) => save.mutate({ api_keys: allowed })}
          />
        </div>
        <p className="text-muted-foreground text-[13px]">
          A key reads the boards its owner can see, and what it reads leaves tiko through their
          script or agent. Switching this off stops every key at once; switching it on again
          restores them.
          {live != null && ` ${live} ${live === 1 ? 'key' : 'keys'} in use.`}
        </p>
      </Group>
    </div>
  )
}
