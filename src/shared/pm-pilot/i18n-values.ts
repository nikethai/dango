/*
 * External text (scope names, mail, model output) passed as i18n interpolation values. i18next expands `{{…}}` found
 * inside a value, so a value that contains one could fill or hide another placeholder. A zero-width space between the
 * braces keeps the text readable and inert. Use for every value of external text given to `i18n.t`.
 */

const ZWSP = '​'

export function inertValue(value: string): string {
  return value.replace(/\{(?=\{)/g, `{${ZWSP}`).replace(/\}(?=\})/g, `}${ZWSP}`)
}

export function inertValues<T extends Record<string, string>>(values: T): T {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, inertValue(v)])) as T
}
