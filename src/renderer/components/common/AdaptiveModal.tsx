import type { ModalProps as MantineModalProps } from '@mantine/core'
import { Button, type ButtonProps, Flex, Stack } from '@mantine/core'
import type { HTMLAttributes, ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { Modal } from '../layout/Overlay'

/** Quick Chat is ~520px (under sm) but is a desktop floating HUD — use centered modal, not mobile sheet. */
function useAdaptiveMobileLayout() {
  const isSmallScreen = useIsSmallScreen()
  const isQuickChat = typeof document !== 'undefined' && document.documentElement.dataset.quickChat === '1'
  return isSmallScreen && !isQuickChat
}

type AdaptiveModalSemanticProps =
  | {
      title: string
      ariaLabel?: never
    }
  | {
      title: ReactElement
      ariaLabel: string
    }
  | {
      title?: undefined
      ariaLabel: string
    }

export type AdaptiveModalProps = Omit<MantineModalProps, 'opened' | 'onClose' | 'title'> &
  AdaptiveModalSemanticProps & {
    opened: boolean
    onClose: () => void
    /**
     * An optional screen-reader description for the mobile drawer. Dialog body
     * content must not be inferred as a description because it can contain
     * interactive controls and arbitrary layout.
     */
    description?: ReactNode
  }

export function AdaptiveModal({
  opened,
  onClose,
  children,
  title,
  ariaLabel,
  description,
  ...props
}: AdaptiveModalProps) {
  const isMobileLayout = useAdaptiveMobileLayout()

  if (isMobileLayout) {
    const hasVisibleStringTitle = typeof title === 'string' && title.length > 0
    const hasVisibleTitleNode = title !== undefined && typeof title !== 'string'
    const hasDescription = description !== undefined && description !== null && description !== ''
    const drawerContentProps = hasDescription ? {} : { 'aria-describedby': undefined }

    return (
      <Drawer.Root open={opened} onOpenChange={(open) => !open && onClose()} noBodyStyles repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay" />
          <Drawer.Content
            {...drawerContentProps}
            // vaul cancels Radix's initial focus (autoFocus=false), leaving the focus trap without an anchor so Tab
            // escapes to the page behind. Focus the sheet itself: Tab then cycles inside it, and no soft keyboard opens.
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              ;(e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
            }}
            className="flex flex-col h-fit fixed bottom-0 left-0 right-0 outline-none bg-chatbox-background-primary rounded-t-lg"
          >
            <Drawer.Handle />
            <Stack gap="md" p="sm" className="max-h-[85vh] overflow-y-auto">
              {hasVisibleStringTitle && (
                <Drawer.Title className="text-center text-base font-semibold">{title}</Drawer.Title>
              )}
              {hasVisibleTitleNode && (
                <>
                  <div>{title}</div>
                  <Drawer.Title className="sr-only">{ariaLabel}</Drawer.Title>
                </>
              )}
              {!hasVisibleStringTitle && !hasVisibleTitleNode && (
                <Drawer.Title className="sr-only">{ariaLabel}</Drawer.Title>
              )}
              {hasDescription && <Drawer.Description className="sr-only">{description}</Drawer.Description>}
              {children}
            </Stack>
            <div className="h-[--mobile-safe-area-inset-bottom] min-h-4" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    )
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title} {...props}>
      {children}
    </Modal>
  )
}

function AdaptiveModalActions({ children }: { children: ReactNode }) {
  const isMobileLayout = useAdaptiveMobileLayout()

  if (isMobileLayout) {
    return (
      <Stack gap="xs" mt="lg" pt="sm" className="flex-col-reverse">
        {children}
      </Stack>
    )
  }

  // wrap so multi-button footers (e.g. Deny / Allow session / Allow once) never clip
  return (
    <Flex gap="sm" mt="md" justify="flex-end" align="center" wrap="wrap" className="w-full">
      {children}
    </Flex>
  )
}

AdaptiveModal.Actions = AdaptiveModalActions

function AdaptiveModalCloseButton(props: ButtonProps & HTMLAttributes<HTMLButtonElement>) {
  const isMobileLayout = useAdaptiveMobileLayout()
  const { t } = useTranslation()
  if (isMobileLayout) {
    return null
  }

  return (
    <Button
      variant="default"
      color="chatbox-secondary"
      size="sm"
      fw={500}
      styles={{
        root: {
          height: 32,
          backgroundColor: 'var(--chatbox-background-tertiary)',
          borderColor: 'var(--chatbox-border-primary)',
          color: 'var(--chatbox-tint-primary)',
          '&:hover': {
            backgroundColor: 'var(--chatbox-background-lift, var(--chatbox-background-tertiary-hover, #2c2c34))',
            borderColor: 'var(--chatbox-border-secondary)',
          },
        },
      }}
      {...props}
    >
      {props.children || t('Cancel')}
    </Button>
  )
}

AdaptiveModal.CloseButton = AdaptiveModalCloseButton
