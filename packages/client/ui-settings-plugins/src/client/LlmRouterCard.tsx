/**
 * The llm-router plugin's card: a JSON editor for the routing pools. The full
 * router configuration is structural (pools/candidates/probes), so this first
 * UI exposes it as a validated JSON document rather than a deeply nested form.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TextAreaField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { LlmRouterCardFace } from './llm-router-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the llm-router card. */
export type LlmRouterCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<LlmRouterCardFace>

/**
 * Render the llm-router card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function LlmRouterCard(props: LlmRouterCardProps) {
  const { t } = props
  const state = props.useLlmRouterCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="llmRouterTitle"
      descriptionKey="llmRouterDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <TextAreaField
        id="plugin-config-llm-router-pools"
        label={t('llmRouterPools')}
        hint={t('llmRouterPoolsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('llmRouterPoolsInvalid')}
        disabled={disabled}
        {...state.pools}
        onEdit={(text) => { props.edit('pools', text) }}
        onReset={() => { props.resetField('pools') }}
      />
    </PluginCard>
  )
}
