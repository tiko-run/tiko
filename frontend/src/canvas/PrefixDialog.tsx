import { useState } from 'react'
import { usePrefixQuestion } from '@/canvas/prefixQuestion'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { openSettings } from '@/settings/store'
import { SourceMark } from '@/sources/SourceMark'
import { prefixNoun, sourceName } from '@/sources/registry'

function listed(parts: string[]) {
  return parts.length < 3
    ? parts.join(' and ')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/** Asks which tracker a bare key comes from when two of the person's trackers know its prefix. */
export function PrefixDialog() {
  const question = usePrefixQuestion()
  const [remember, setRemember] = useState(false)
  if (!question) return null
  const { prefix, key, sources, answer } = question
  const pick = (source: string) => {
    answer({ source, remember })
    setRemember(false)
  }
  const cancel = () => {
    answer(null)
    setRemember(false)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Where is {key} from?</DialogTitle>
          <DialogDescription>
            {prefix} is{' '}
            {listed(sources.map((source) => `${prefixNoun(source)} in ${sourceName(source)}`))}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {sources.map((source) => (
            <Button key={source} variant="outline" onClick={() => pick(source)}>
              <SourceMark source={source} />
              {sourceName(source)}
            </Button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <Checkbox checked={remember} onCheckedChange={(value) => setRemember(value === true)} />
          Remember for {prefix}
        </label>
        <p className="text-muted-foreground text-[13px]">
          Change a remembered choice in{' '}
          <button
            type="button"
            className="hover:text-foreground underline underline-offset-3"
            onClick={() => {
              cancel()
              openSettings('tracker')
            }}
          >
            Settings → My tracker
          </button>
          .
        </p>
      </DialogContent>
    </Dialog>
  )
}
