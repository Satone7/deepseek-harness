/**
 * Product version row registered into the General section item slot:
 * read-only title + value. The value arrives from the connection service's
 * mirror of the host Web bundle's page injection, and the row registers only
 * when that mirror exists, so a context the Web host did not serve shows no
 * row at all.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './VersionRow.module.css'

/** Injected business face: the serving product version. */
export interface VersionRowInjected {
  /** The serving dsh release version (the Web bundle's package version). */
  version: string
}

/** Full component props: runtime share + locale seat + injected version. */
export type VersionRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & VersionRowInjected

/**
 * Render the Version row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function VersionRow({ t, version }: VersionRowComponentProps) {
  return (
    <div className={css.row}>
      <div className={css.title}>{t('version.title')}</div>
      <div className={css.value}>{version}</div>
    </div>
  )
}
