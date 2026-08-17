/**
 * The llm-router card's staged form over the `llm-router` settings namespace.
 * The namespace is Host-owned; the client spells the same value rather than
 * importing a Host package.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, jsonField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

/** Namespace of the llm-router capability. */
export const LLM_ROUTER_NS = 'llm-router'

/**
 * The llm-router field this card edits. The whole routing configuration is a
 * structured JSON document (`pools`), so the card exposes it as one JSON
 * textarea rather than a deeply nested hand-written form.
 */
export interface LlmRouterSettings {
  /** Routing pools. */
  pools?: unknown
}

/** What the llm-router card renders. */
export interface LlmRouterCardState extends CardShell {
  /** Pretty-printed JSON of the routing pools. */
  pools: CardFieldState
}

/** The registration-side face the llm-router card's slot entry injects. */
export interface LlmRouterCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useLlmRouterCard. */
    llmRouterCard: SnapshotStore<LlmRouterCardState>
  }
}

/** Bridges the `llm-router` scope onto the card's staged form. */
export class LlmRouterCardController {
  private readonly form: CardForm<LlmRouterSettings>
  private readonly store: SnapshotStore<LlmRouterCardState>

  /** @param scope - the bound settings scope for the `llm-router` namespace. */
  constructor(scope: SettingsScope<LlmRouterSettings>) {
    this.form = new CardForm(scope, [jsonField('pools')])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LlmRouterCardState {
    return { ...this.form.shell(), pools: this.form.field('pools') }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): LlmRouterCardFace {
    return { hooks: { llmRouterCard: this.store }, ...this.form.actions() }
  }
}
