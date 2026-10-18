import { Container, Stack, Text, Title } from '@mantine/core'
import type { ReviewEntry } from '@shared/types/review'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { MASCOT_STATE_LABEL, Mascot, type MascotState } from '@/components/brand/Mascot'
import { ReviewItem, type ReviewItemProps } from '@/components/review'
import { Sheet } from '@/components/ui/Sheet'
import { useReviewEntries, useReviewRenderer } from '@/packages/review'
import { pushUndo } from '@/packages/undo'
import { useUIStore } from '@/stores/uiStore'
import tokens from '../../../../design/dango/tokens.json'
import { type DangoColor, dangoColors } from '../../theme/dangoTokens'

export const Route = createFileRoute('/dev/design-system')({
  component: RouteComponent,
})

type TypeStyle = {
  name: string
  fontSize: string
  lineHeight: string
  fontWeight: number
  letterSpacing?: string
  sample: string
}

type TypeGroup = { name: string; family: 'sans' | 'mono'; styles: TypeStyle[] }

const typeGroups = tokens.type.groups as TypeGroup[]
const noop = () => {}

const mascotStates = Object.keys(MASCOT_STATE_LABEL) as MascotState[]

const reviewItems: ReviewItemProps[] = [
  {
    kind: 'proposal',
    scope: 'Acme Co',
    source: 'docs/specs/2026-10-16-redesign-brief.md',
    text: 'Move the launch date to 14 November in the redesign brief.',
    actions: [
      { label: 'Approve', onClick: noop, variant: 'primary' },
      { label: 'Edit', onClick: noop },
    ],
  },
  {
    kind: 'done',
    scope: 'Acme Co',
    text: 'Sent the September invoice.',
    sub: '2 files changed',
    actions: [{ label: 'Undo', onClick: noop, variant: 'ghost' }],
  },
  {
    kind: 'needs-you',
    scope: 'Acme Co',
    text: 'Two quotes found: 8,400 (12 Sep) and 9,100 (30 Sep). Which is current?',
    actions: [
      { label: '8,400', onClick: noop },
      { label: '9,100', onClick: noop },
    ],
  },
  {
    kind: 'conflict',
    scope: 'Acme Co',
    source: 'a/very/long/unbroken/path/that/keeps/going/and/going/without/any/break/in/it/notes-2026-10-16-final-v2.md',
    text: 'The brief and the meeting notes disagree on the budget.',
    actions: [
      { label: 'Keep brief', onClick: noop, variant: 'primary' },
      { label: 'Keep notes', onClick: noop },
      { label: 'Ask later', onClick: noop, variant: 'ghost' },
      { label: 'Never shown', onClick: noop },
    ],
  },
  {
    kind: 'change',
    scope: 'Acme Co',
    text: 'The pricing page now lists three plans instead of two.',
    actions: [
      { label: 'Accept', onClick: noop, variant: 'primary' },
      { label: 'Revert', onClick: noop },
    ],
  },
  {
    kind: 're-check',
    scope: 'Acme Co',
    text: 'The supplier terms changed since you last approved them.',
    actions: [
      { label: 'Re-check', onClick: noop, variant: 'primary' },
      { label: 'Dismiss', onClick: noop, variant: 'ghost' },
    ],
  },
]

function ReviewRendererEntry({ entry }: { entry: ReviewEntry }) {
  const Renderer = useReviewRenderer(entry)
  return Renderer ? <Renderer entry={entry} focused={false} /> : null
}

function ReviewRenderers() {
  const entries = useReviewEntries().filter(
    (e) => e.state === 'open' && (e.kind === 'proposal' || e.kind === 'conflict' || e.kind === 're-check')
  )
  return (
    <section>
      <Title order={3} mb="md">
        Review renderers
      </Title>
      <Stack gap="sm">
        {entries.length === 0 ? <Text size="sm">No open proposal, conflict or re-check entries.</Text> : null}
        {entries.map((entry) => (
          <ReviewRendererEntry key={entry.id} entry={entry} />
        ))}
      </Stack>
    </section>
  )
}

function RouteComponent() {
  const realTheme = useUIStore((state) => state.realTheme)
  const colors = dangoColors[realTheme]
  const [sheet, setSheet] = useState<'bottom' | 'right' | null>(null)
  const closeSheet = () => setSheet(null)

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <div>
          <Title order={1}>Design system</Title>
          <Text c="dimmed">Dango tokens and components for the {realTheme} theme.</Text>
        </div>

        <section>
          <Title order={3} mb="md">
            Colours
          </Title>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {(Object.keys(colors) as DangoColor[]).map((name) => (
              <div
                key={name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 8,
                  borderRadius: 'var(--dango-radius-md)',
                  border: '1px solid var(--dango-hairline)',
                  background: 'var(--dango-raised)',
                  color: 'var(--dango-ink)',
                  fontFamily: 'var(--dango-font-sans)',
                  fontSize: 13,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: 'none',
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--dango-radius-sm)',
                    border: '1px solid var(--dango-hairline)',
                    background: colors[name],
                  }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <strong style={{ fontWeight: 600 }}>{name}</strong>
                  <span style={{ fontFamily: 'var(--dango-font-mono)', fontSize: 12, color: 'var(--dango-muted)' }}>
                    {colors[name]}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <Title order={3} mb="md">
            Type
          </Title>
          <Stack gap="lg">
            {typeGroups.map((group) => (
              <div key={group.name}>
                <Text fw={600} mb="xs">
                  {group.name}
                </Text>
                <Stack gap="sm">
                  {group.styles.map((style) => (
                    <div key={style.name}>
                      <Text size="xs" c="dimmed" ff="monospace">
                        {style.name} · {style.fontSize} / {style.lineHeight} · {style.fontWeight}
                      </Text>
                      <div
                        style={{
                          fontFamily: `var(--dango-font-${group.family})`,
                          fontSize: style.fontSize,
                          lineHeight: style.lineHeight,
                          fontWeight: style.fontWeight,
                          letterSpacing: style.letterSpacing,
                          color: 'var(--dango-ink)',
                        }}
                      >
                        {style.sample}
                      </div>
                    </div>
                  ))}
                </Stack>
              </div>
            ))}
          </Stack>
        </section>

        <section>
          <Title order={3} mb="md">
            Review items
          </Title>
          <Stack gap="sm">
            {reviewItems.map((item) => (
              <ReviewItem key={item.kind} {...item} />
            ))}
          </Stack>
        </section>

        {import.meta.env.DEV ? <ReviewRenderers /> : null}

        <section>
          <Title order={3} mb="md">
            Mascot
          </Title>
          <Stack gap="md">
            {[56, 24].map((size) => (
              <div
                key={size}
                data-mascot-row={size}
                style={{ display: 'flex', flexWrap: 'wrap', gap: 24, color: 'var(--dango-ink)' }}
              >
                {mascotStates.map((state) => (
                  <div
                    key={state}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 72 }}
                  >
                    <Mascot state={state} size={size as 56 | 24} />
                    <Text size="xs" c="dimmed">
                      {MASCOT_STATE_LABEL[state]}
                    </Text>
                  </div>
                ))}
              </div>
            ))}
          </Stack>
        </section>

        <section>
          <Title order={3} mb="md">
            Sheet
          </Title>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" className="dg-btn" onClick={() => setSheet('bottom')}>
              Open sheet from the bottom
            </button>
            <button type="button" className="dg-btn" onClick={() => setSheet('right')}>
              Open sheet from the right
            </button>
          </div>
          <Sheet
            opened={sheet !== null}
            onClose={closeSheet}
            side={sheet === 'right' ? 'right' : 'bottom'}
            title="Dango wants to edit 3 files"
            hint="Esc closes"
            actions={
              <>
                <button type="button" className="dg-btn dg-btn--ghost" onClick={closeSheet}>
                  Not now
                </button>
                <button type="button" className="dg-btn" onClick={closeSheet}>
                  Always in this scope
                </button>
                <button type="button" className="dg-btn dg-btn--primary" onClick={closeSheet}>
                  Allow once
                </button>
              </>
            }
          >
            <p>
              Why: move plans/ into docs/specs and fix the links. Touches README.md, AGENTS.md, docs/log.md in Dango.
            </p>
          </Sheet>
        </section>

        <section>
          <Title order={3} mb="md">
            Undo
          </Title>
          <button
            type="button"
            className="dg-btn"
            onClick={() => pushUndo({ message: 'Approved "Launch is 6 Nov" for Acme Co', undo: () => {} })}
          >
            Push an undo
          </button>
        </section>
      </Stack>
    </Container>
  )
}
