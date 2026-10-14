import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowUpCircle, BookOpen, Bug, Info, ShieldAlert } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { checkVersionNow, useVersion, type ReleaseLevel } from '@/api/version'
import { Emblem } from '@/components/Emblem'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { UpdateAction } from '@/board/UpdateAction'
import { watchedUpdate } from '@/board/UpdateProgress'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const REPO = 'https://github.com/tiko-run/tiko'
const DOCS = 'https://docs.tiko.run'
const UPGRADE_DOCS = `${DOCS}/data-and-upgrades/`

const LEVEL_LABEL: Record<ReleaseLevel, string | null> = {
  feature: null,
  hotfix: 'Hotfix',
  breaking: 'Breaking changes',
  security: 'Security',
}

// lucide dropped brand icons, so this is the Octicons mark (MIT).
function GitHubIcon(props: ComponentProps<'svg'>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  )
}

function AboutLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] [&_svg]:size-4 [&_svg]:shrink-0"
    >
      {icon}
      {children}
    </a>
  )
}

export function AboutButton({ admin = false }: { admin?: boolean }) {
  const queryClient = useQueryClient()
  const info = useVersion().data
  const check = useMutation({
    mutationFn: checkVersionNow,
    onSuccess: async (fresh) => {
      // A poll still in flight would otherwise land after this and hide what it found.
      await queryClient.cancelQueries({ queryKey: ['version'] })
      queryClient.setQueryData(['version'], fresh)
    },
    onError: toastError,
  })
  const update = info?.update_available ? info.latest : null
  const security = info?.level === 'security'
  const label = update
    ? security
      ? 'About tiko, security update available'
      : 'About tiko, update available'
    : 'About tiko'
  return (
    <Popover>
      <div className="bg-card absolute bottom-4 left-4 z-10 rounded-lg border p-1 shadow-md">
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={label}
            title={update ? `About tiko: v${update.version} is available` : 'About tiko'}
          >
            <Info className="size-[18px]" strokeWidth={1.75} />
            {update && (
              <span
                aria-hidden
                className={cn(
                  'ring-card absolute top-1 right-1 size-2 rounded-full ring-2',
                  security ? 'bg-destructive' : 'bg-primary',
                )}
              />
            )}
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent side="top" align="start" className="w-80 gap-3 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-1.5 self-center text-[16px] font-semibold tracking-[-0.03em]">
            <Emblem className="size-5" />
            tiko
          </h2>
          {info && (
            <a
              href={`${REPO}/releases/tag/v${info.version}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground font-mono text-[12px]"
              title="Release notes for this version"
            >
              v{info.version}
            </a>
          )}
        </div>
        {(update || watchedUpdate()) && info && (
          <div className="bg-accent flex items-start gap-2 rounded-md p-2 text-[13px]">
            {security ? (
              <ShieldAlert className="text-destructive mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            ) : (
              <ArrowUpCircle className="text-primary mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-medium">
                {info.newer.length > 1
                  ? `${info.newer.length} new versions available`
                  : 'New version available'}
              </span>
              {security && (
                <span className="text-destructive">Includes a security fix. Update soon.</span>
              )}
              <ul className="flex max-h-28 flex-col overflow-y-auto" aria-label="New releases">
                {info.newer.map((release) => (
                  <li key={release.version} className="flex items-baseline gap-2">
                    <a
                      href={release.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary font-mono text-[12px]"
                    >
                      v{release.version}
                    </a>
                    {LEVEL_LABEL[release.level] && (
                      <span
                        className={cn(
                          'text-[12px]',
                          release.level === 'security'
                            ? 'text-destructive'
                            : 'text-muted-foreground',
                        )}
                      >
                        {LEVEL_LABEL[release.level]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <UpdateAction info={info} admin={admin} />
              <a href={UPGRADE_DOCS} target="_blank" rel="noreferrer" className="text-primary">
                How to upgrade
              </a>
            </div>
          </div>
        )}
        {info?.update_check && (
          <div className="text-muted-foreground -my-1 flex items-center justify-between text-[12px]">
            <span>
              {update
                ? ''
                : info.latest
                  ? 'You are on the latest version'
                  : 'No answer from GitHub yet'}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              {check.isPending ? 'Checking…' : 'Check now'}
            </Button>
          </div>
        )}
        <p className="text-muted-foreground text-[13px] leading-normal">
          An infinite canvas for your tasks: live cards from your tracker, arranged the way you
          think. Open source, self-hosted, no tracking.
        </p>
        <nav className="-mx-2 flex flex-col" aria-label="tiko links">
          <AboutLink href={REPO} icon={<GitHubIcon />}>
            Source code on GitHub
          </AboutLink>
          <AboutLink href={DOCS} icon={<BookOpen strokeWidth={1.75} />}>
            Documentation
          </AboutLink>
          <AboutLink href={`${REPO}/issues/new/choose`} icon={<Bug strokeWidth={1.75} />}>
            Report a bug or idea
          </AboutLink>
        </nav>
        <p className="text-muted-foreground border-t pt-2 text-[12px]">AGPL-3.0 license</p>
      </PopoverContent>
    </Popover>
  )
}
