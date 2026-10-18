import { useState } from 'react'
import { readPasteAs, writePasteAs, type PasteAs } from '@/canvas/paste'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { readOpenIn, writeOpenIn, type OpenIn } from '@/lib/task-links'
import { useTheme, type Theme } from '@/lib/theme'
import { Group, SectionHeader } from '@/settings/sections/Section'

function Choice({ value, id, label }: { value: string; id: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem value={value} id={id} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

// Kept in this browser, not on the server, like the other view preferences.
export function Preferences() {
  const { theme, setTheme } = useTheme()
  const [pasteAs, setPasteAs] = useState<PasteAs>(readPasteAs)
  const [openIn, setOpenIn] = useState<OpenIn>(readOpenIn)
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        title="Preferences"
        description="How tiko looks and behaves in this browser."
      />
      <Group title="Theme">
        <RadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          <Choice value="light" id="theme-light" label="Light" />
          <Choice value="dark" id="theme-dark" label="Dark" />
          <Choice value="system" id="theme-system" label="Same as the system" />
        </RadioGroup>
      </Group>
      <Group title="Paste text as">
        <RadioGroup
          value={pasteAs}
          onValueChange={(next) => {
            setPasteAs(next as PasteAs)
            writePasteAs(next as PasteAs)
          }}
        >
          <Choice value="text" id="paste-text" label="Text" />
          <Choice value="sticky" id="paste-sticky" label="Sticky note" />
        </RadioGroup>
        <p className="text-muted-foreground text-[13px]">
          Task keys and links always become cards.
        </p>
      </Group>
      <Group title="Open task links in">
        <RadioGroup
          value={openIn}
          onValueChange={(next) => {
            setOpenIn(next as OpenIn)
            writeOpenIn(next as OpenIn)
          }}
        >
          <Choice value="new" id="links-new" label="A new tab" />
          <Choice value="same" id="links-same" label="This tab" />
        </RadioGroup>
        <p className="text-muted-foreground text-[13px]">
          Links on cards, in the mini-card and in the Gantt. Cmd or Ctrl + click still opens a new
          tab.
        </p>
      </Group>
    </div>
  )
}
