import {
  ActionIcon,
  Avatar,
  Button,
  Checkbox,
  Combobox,
  ComboboxChevron,
  type CSSVariablesResolver,
  colorsTuple,
  createTheme,
  type DefaultMantineColor,
  Drawer,
  Input,
  type MantineColorsTuple,
  Modal,
  NativeSelect,
  Popover,
  Radio,
  rem,
  Select,
  Slider,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'

const ON_BRAND = 'var(--chatbox-tint-on-brand)'
// the danger fill is light in dark mode, so it takes the raised surface colour as text (>= 4.5:1 in both themes)
const ON_DANGER = 'var(--dango-raised)'
// the grey fill (--chatbox-background-gray-primary) stays dark in both themes, so its label is white
const ON_GRAY = 'var(--chatbox-tint-white)'

// Brand (the primary colour, used when no colour is given) and success both fill with --dango-green.
const isGreen = (color: unknown) => color === undefined || color === 'chatbox-brand' || color === 'chatbox-success'
// Mantine's default variant is `filled`.
const isFilled = (variant?: string) => variant === undefined || variant === 'filled'

/**
 * Text colour for a filled control, or undefined to keep Mantine's default.
 */
const filledTextColor = (props: { variant?: string; color?: unknown }): string | undefined => {
  if (!isFilled(props.variant)) {
    return undefined
  }
  if (isGreen(props.color)) {
    return ON_BRAND
  }
  if (props.color === 'chatbox-error') {
    return ON_DANGER
  }
  if (props.color === 'chatbox-gray') {
    return ON_GRAY
  }
  return undefined
}

/**
 * Tick / dot colour for a checked Checkbox or Radio: Mantine paints it white, which fails on the dark-mode green.
 * An explicit `iconColor` and the outline variant (whose icon is the control colour) keep Mantine's own.
 */
const greenIconColor = (props: { variant?: string; color?: unknown; iconColor?: unknown }) =>
  props.iconColor === undefined && isFilled(props.variant) && isGreen(props.color) ? ON_BRAND : undefined

/**
 * Mantine's semantic colour variables, mapped onto Dango. The Dango variables flip with the colour scheme on their
 * own (see dango-tokens.css), so light and dark carry the same values. They go under `light`/`dark` rather than
 * `variables` because Mantine declares its defaults at that specificity.
 */
export const DANGO_MANTINE_SEMANTIC_VARIABLES = {
  '--mantine-color-body': 'var(--dango-ground)',
  '--mantine-color-text': 'var(--dango-ink)',
  '--mantine-color-dimmed': 'var(--dango-muted)',
  '--mantine-color-placeholder': 'var(--dango-muted)',
  '--mantine-color-default-border': 'var(--dango-line)',
  '--mantine-color-default': 'var(--dango-raised)',
  '--mantine-color-default-hover': 'var(--dango-surface)',
  '--mantine-color-default-color': 'var(--dango-ink)',
} as const

export const dangoCssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { ...DANGO_MANTINE_SEMANTIC_VARIABLES },
  dark: { ...DANGO_MANTINE_SEMANTIC_VARIABLES },
})

// fields must be seen: the control border is the 3:1 one, the fill is the raised surface
const INPUT_BG = 'var(--dango-raised)'
const INPUT_BORDER = 'var(--dango-control-border)'
const INPUT_COLOR = 'var(--dango-ink)'
const INPUT_PLACEHOLDER = 'var(--dango-muted)'

export const createDangoMantineTheme = (scale = 1) =>
  createTheme({
    /** Dango shell — system UI font, tight radii, green brand; all colours/fonts via CSS tokens */
    scale,
    // A11Y1 rule 2: with prefers-reduced-motion, Modal, Menu, Popover, Tooltip and Collapse skip their transitions
    // (duration 0; Collapse then renders without waiting for transitionend).
    respectReducedMotion: true,
    fontFamily: 'var(--chatbox-font-ui)',
    fontFamilyMonospace: 'var(--chatbox-font-mono)',
    primaryColor: 'chatbox-brand',
    defaultRadius: 'md',
    colors: {
      'chatbox-brand': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-brand)')),
      'chatbox-gray': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-gray)')),
      'chatbox-success': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-success)')),
      'chatbox-error': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-error)')),
      'chatbox-warning': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-warning)')),

      'chatbox-primary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-primary)')),
      'chatbox-secondary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-secondary)')),
      'chatbox-tertiary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-tertiary)')),
    },
    headings: {
      fontFamily: 'var(--chatbox-font-ui)',
      fontWeight: '600',
      sizes: {
        h1: {
          fontSize: 'calc(2.5rem * var(--mantine-scale))', // 40px
          lineHeight: '1.2', // 48px
        },
        h2: {
          fontSize: 'calc(2rem * var(--mantine-scale))', // 32px
          lineHeight: '1.25', //  40px
        },
        h3: {
          fontSize: 'calc(1.5rem * var(--mantine-scale))', // 24px
          lineHeight: '1.3333333333', // 32px
        },
        h4: {
          fontSize: 'calc(1.125rem * var(--mantine-scale))', // 18px
          lineHeight: '1.3333333333', // 24px
        },
        h5: {
          fontSize: 'calc(1rem * var(--mantine-scale))', // 16px
          lineHeight: '1.25', // 20px
        },
        h6: {
          fontSize: 'calc(0.75rem * var(--mantine-scale))', // 12px
          lineHeight: '1.3333333333', // 16px
        },
      },
    },
    fontSizes: {
      xxs: 'calc(0.625rem * var(--mantine-scale))', // 10px
      xs: 'calc(0.75rem * var(--mantine-scale))', // 12px
      sm: 'calc(0.875rem * var(--mantine-scale))', // 14px
      md: 'calc(1rem * var(--mantine-scale))', // 16px
      lg: 'calc(1.125rem * var(--mantine-scale))', // 18px
      xl: 'calc(1.25rem * var(--mantine-scale))', // 20px
    },
    lineHeights: {
      xxs: '1.3', // 13px
      xs: '1.3333333333', // 16px
      sm: '1.4285714286', // 20px
      md: '1.55',
      lg: '1.5555555556', // 28px
      xl: '1.6', // 32px
    },
    // Dango radii: 4 / 6 / 8 / 10 / 12 / 16
    radius: {
      xs: 'calc(0.25rem * var(--mantine-scale))',
      sm: 'calc(0.375rem * var(--mantine-scale))',
      md: 'calc(0.5rem * var(--mantine-scale))',
      lg: 'calc(0.625rem * var(--mantine-scale))',
      xl: 'calc(0.75rem * var(--mantine-scale))',
      xxl: 'calc(1rem * var(--mantine-scale))',
    },
    spacing: {
      '3xs': 'calc(0.125rem * var(--mantine-scale))',
      xxs: 'calc(0.25rem * var(--mantine-scale))',
      xs: 'calc(0.5rem * var(--mantine-scale))',
      sm: 'calc(0.75rem * var(--mantine-scale))',
      md: 'calc(1rem * var(--mantine-scale))',
      lg: 'calc(1.25rem * var(--mantine-scale))',
      xl: 'calc(1.5rem * var(--mantine-scale))',
      xxl: 'calc(2rem * var(--mantine-scale))',
    },
    components: {
      Text: Text.extend({
        defaultProps: {
          size: 'sm',
          c: 'chatbox-primary',
        },
      }),
      Title: Title.extend({
        defaultProps: {
          c: 'chatbox-primary',
        },
      }),
      Button: Button.extend({
        defaultProps: {
          color: 'chatbox-brand',
        },
        styles: () => ({
          root: {
            '--button-height-sm': rem('32px'),
            '--button-height-compact-xs': rem('24px'),
            fontWeight: '400',
          },
          label: {
            color: 'inherit',
          },
        }),
        // flat CSS-var palettes have no auto-contrast: filled buttons pick their text colour explicitly
        vars: (_theme, props) => {
          const color = filledTextColor(props)
          return { root: color ? { '--button-color': color } : {} }
        },
      }),
      ActionIcon: ActionIcon.extend({
        vars: (_theme, props) => {
          const color = filledTextColor(props)
          return { root: color ? { '--ai-color': color } : {} }
        },
      }),
      Input: Input.extend({
        styles: (_theme, props) => ({
          wrapper: {
            '--input-height-sm': rem('36px'),
            '--input-bd': INPUT_BORDER,
            '--input-bg': INPUT_BG,
            '--input-color': INPUT_COLOR,
            '--input-placeholder-color': INPUT_PLACEHOLDER,
            ...(props.error
              ? {
                  '--input-color': 'var(--chatbox-tint-error)',
                  '--input-bd': 'var(--chatbox-tint-error)',
                }
              : {}),
          },
          input: {
            backgroundColor: INPUT_BG,
            borderColor: INPUT_BORDER,
            color: INPUT_COLOR,
            borderRadius: 'var(--chatbox-radius-md)',
            fontSize: '0.875rem',
            transition: 'border-color 140ms var(--chatbox-ease), background-color 140ms var(--chatbox-ease)',
            '&:focus, &:focus-within': {
              borderColor: 'var(--chatbox-tint-brand)',
            },
            '&::placeholder': {
              color: INPUT_PLACEHOLDER,
            },
          },
        }),
      }),
      TextInput: TextInput.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
            color: 'var(--chatbox-tint-secondary)',
            fontSize: '0.8125rem',
          },
          description: {
            color: 'var(--chatbox-tint-tertiary)',
          },
          input: {
            backgroundColor: INPUT_BG,
            borderColor: INPUT_BORDER,
            color: INPUT_COLOR,
            borderRadius: 'var(--chatbox-radius-md)',
          },
        }),
      }),
      Textarea: TextInput.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
            color: 'var(--chatbox-tint-secondary)',
            fontSize: '0.8125rem',
          },
          input: {
            backgroundColor: INPUT_BG,
            borderColor: INPUT_BORDER,
            color: INPUT_COLOR,
            borderRadius: 'var(--chatbox-radius-md)',
          },
        }),
      }),
      Select: Select.extend({
        defaultProps: {
          size: 'sm',
          allowDeselect: false,
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
            color: 'var(--chatbox-tint-secondary)',
            fontSize: '0.8125rem',
          },
          input: {
            backgroundColor: INPUT_BG,
            borderColor: INPUT_BORDER,
            color: INPUT_COLOR,
            borderRadius: 'var(--chatbox-radius-md)',
          },
          dropdown: {
            backgroundColor: 'var(--chatbox-background-secondary)',
            borderColor: 'var(--chatbox-border-secondary)',
          },
          option: {
            borderRadius: 'var(--chatbox-radius-sm)',
          },
        }),
      }),
      NativeSelect: NativeSelect.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
            color: 'var(--chatbox-tint-secondary)',
            fontSize: '0.8125rem',
          },
          input: {
            backgroundColor: INPUT_BG,
            borderColor: INPUT_BORDER,
            color: INPUT_COLOR,
            borderRadius: 'var(--chatbox-radius-md)',
          },
        }),
      }),
      Switch: Switch.extend({
        defaultProps: {
          size: 'sm',
        },
        // Mantine's thumb is white whether or not it is checked, and --switch-thumb-bg is not state-aware: the root
        // hands the checked colour to the `.mantine-Switch-input:checked` rule in globals.css
        styles: (_theme, props) => {
          return {
            root: isGreen(props.color) ? { '--chatbox-switch-checked-thumb': ON_BRAND } : {},
            label: {
              color: props.checked ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-tertiary)',
            },
          }
        },
      }),
      Checkbox: Checkbox.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: (_theme, props) => ({
          label: {
            color: props.checked ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-tertiary)',
          },
        }),
        vars: (_theme, props) => {
          const color = greenIconColor(props)
          return { root: color ? { '--checkbox-icon-color': color } : {} }
        },
      }),
      Radio: Radio.extend({
        vars: (_theme, props) => {
          const color = greenIconColor(props)
          return { root: color ? { '--radio-icon-color': color } : {} }
        },
      }),
      Modal: Modal.extend({
        defaultProps: {
          zIndex: 2000,
          radius: 'md',
          padding: 'md',
          shadow: 'xl',
          overlayProps: {
            backgroundOpacity: 0.62,
            blur: 2,
          },
        },
        classNames: {
          content: 'studio-modal-content',
          header: 'studio-modal-header',
          body: 'studio-modal-body',
          title: 'studio-modal-title',
          close: 'studio-modal-close',
        },
        styles: () => ({
          content: {
            backgroundColor: 'var(--chatbox-background-secondary)',
            border: '1px solid var(--chatbox-border-secondary)',
            borderRadius: 'var(--chatbox-radius-lg)',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.55)',
          },
          header: {
            backgroundColor: 'var(--chatbox-background-secondary)',
            borderBottom: '1px solid var(--chatbox-border-primary)',
            paddingBottom: 'var(--chatbox-spacing-sm)',
            marginBottom: 0,
            minHeight: rem('48px'),
          },
          title: {
            fontWeight: '600',
            color: 'var(--chatbox-tint-primary)',
            fontSize: '0.9375rem',
            letterSpacing: '-0.015em',
          },
          body: {
            paddingTop: 'var(--chatbox-spacing-md)',
          },
          close: {
            width: rem('28px'),
            height: rem('28px'),
            color: 'var(--chatbox-tint-tertiary)',
            borderRadius: 'var(--chatbox-radius-sm)',
            '&:hover': {
              backgroundColor: 'var(--chatbox-background-tertiary)',
              color: 'var(--chatbox-tint-primary)',
            },
          },
          overlay: {
            '--overlay-bg': 'var(--chatbox-background-mask-overlay)',
          },
        }),
      }),
      Drawer: Drawer.extend({
        defaultProps: {
          zIndex: 2000,
        },
        styles: () => ({
          title: {
            fontWeight: '600',
            color: 'var(--chatbox-tint-primary)',
            fontSize: '0.9375rem',
            letterSpacing: '-0.015em',
          },
          close: {
            width: rem('28px'),
            height: rem('28px'),
            color: 'var(--chatbox-tint-tertiary)',
          },
          content: {
            backgroundColor: 'var(--chatbox-background-secondary)',
            borderColor: 'var(--chatbox-border-primary)',
          },
          header: {
            borderBottom: '1px solid var(--chatbox-border-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--chatbox-background-mask-overlay)',
          },
        }),
      }),
      Combobox: Combobox.extend({
        defaultProps: {
          shadow: 'md',
          zIndex: 2100,
        },
      }),
      // Mantine tints the chevron with dark-3 / gray-6; it is an icon, so it takes the muted text colour
      // (the error state keeps Mantine's own error colour)
      ComboboxChevron: ComboboxChevron.extend({
        vars: (_theme, props) => ({
          chevron: props.error ? {} : { '--combobox-chevron-color': 'var(--dango-muted)' },
        }),
      }),
      Avatar: Avatar.extend({
        styles: () => ({
          image: {
            objectFit: 'contain',
          },
        }),
      }),
      Tooltip: Tooltip.extend({
        defaultProps: {
          zIndex: 3000,
        },
      }),
      Popover: Popover.extend({
        defaultProps: {
          zIndex: 3000,
        },
      }),
      Slider: Slider.extend({
        classNames: {
          trackContainer: 'max-sm:pointer-events-none',
          thumb: 'max-sm:pointer-events-auto',
        },
      }),
    },
  })

type ExtendedCustomColors =
  | 'chatbox-brand'
  | 'chatbox-gray'
  | 'chatbox-success'
  | 'chatbox-error'
  | 'chatbox-warning'
  | 'chatbox-primary'
  | 'chatbox-secondary'
  | 'chatbox-tertiary'
  | DefaultMantineColor

declare module '@mantine/core' {
  export interface MantineThemeColorsOverride {
    colors: Record<ExtendedCustomColors, MantineColorsTuple>
  }
}
