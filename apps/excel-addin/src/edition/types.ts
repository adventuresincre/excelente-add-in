import type { ComponentType } from "react";
import type { McpManager } from "../core/mcp";
import type { ModelInfo, OpenRouterClient } from "../core/openrouter";
import type { ModelPref } from "../core/storage";

/**
 * The edition contract.
 *
 * Excelente ships in editions. The shared tree (everything outside
 * `src/edition/`) is the same in every edition and never names one. Each
 * edition lives in its own folder under `src/edition/<name>/` and implements
 * this interface; the build picks one folder and aliases `@edition` to it
 * (see `vite.config.ts` and `scripts/lib/edition.mjs`).
 *
 *   - `community` ships in the public repository. Bring your own OpenRouter
 *     key; no hosted models; the five CC BY skills.
 *   - Other editions add what a hosted distribution needs: models the host
 *     pays for and pins server-side, memberships that unlock them, extra
 *     skills, and copy.
 *
 * Rules that keep the seam clean (enforced by `scripts/check-edition-boundary.mjs`):
 *
 *   1. Only `src/ui/**` and `src/taskpane/**` import `@edition`. `src/core/**`
 *      stays edition-free; whatever it needs is passed in.
 *   2. Nothing outside an edition folder imports from inside it.
 *   3. Editions do not import each other.
 *
 * Keep this interface small. Add a slot when a real feature needs one, not
 * before; every slot is a promise every edition has to keep.
 */

/**
 * A model the edition hosts itself. The user has no key for it; the edition
 * supplies a client that reaches a host which holds the credential and pins
 * the real model server-side. In the picker it is a synthetic row (never in
 * the OpenRouter list) that sits in its own group before every lab. Whether
 * the user may run it right now is the edition's call (`useEntitledHostedIds`).
 */
export interface HostedModel {
  /** Sentinel stored in `ModelPref.modelId`. Never a real OpenRouter id. */
  id: string;
  /** The row's name with no live model in it, e.g. the tier name. */
  name: string;
  /**
   * The OpenRouter id the host substitutes for the sentinel. Used wherever
   * a real id is needed client-side: the reasoning-policy lookup, the
   * per-model cost breakdown, and to recognise the pin when it is written
   * into role ids. The host may re-pin at any time; this is the fallback.
   */
  upstreamModelId: string;
  /** The preference to store when the user picks this row. Every role pinned. */
  modelPref(): ModelPref;
  /** Client that reaches the host. Cached by the edition; call freely. */
  client(): OpenRouterClient;
  /**
   * Live name, e.g. "Tier (Model Name)", rendered as a component so the
   * lookup that names the pinned model only runs where the name is shown.
   */
  LiveName: ComponentType;
  /** Empty-chat intro paragraph shown while this model is the one running. */
  ChatIntro: ComponentType;
  /** One sentence under the setup picker when this row is chosen. */
  setupPickHint?: string;
  /** One sentence under the setup picker when this row is picked but locked. */
  lockedHint?: string;
  /** Footnote under the session-cost row, for a tier where someone else pays. */
  costNote?: string;
}

/** What the shared tree hands an edition once, when the app is ready. */
export interface EditionServices {
  /** The MCP manager: connector configs, credentials and connection state. */
  mcp: McpManager;
  /** Put a connected server's tools in the agent's active toolbelt. */
  enableConnector: (name: string) => void;
  disableConnector: (name: string) => void;
}

export interface SetupIntroProps {
  /** The user will bring their own OpenRouter key; continue to the key step. */
  onOwnModel: () => void;
  /**
   * The user chose a hosted model. `alsoOwnKey` says whether they also
   * want to add a key now (key step next) or go straight to chat.
   */
  onHosted: (model: HostedModel, alsoOwnKey: boolean) => void;
}

export interface Edition {
  /** Folder name under `src/edition/`. */
  id: string;
  /** Hosted rows, in picker order. Empty in the community edition. */
  hostedModels: readonly HostedModel[];
  /**
   * What runs when the chosen model has no key to run on, provided the user
   * is entitled to it. `null` means nothing runs: the choice is kept, chat
   * locks, and the only way forward is a key (see `ui/taskpane/pending-model`).
   */
  keylessFallback: HostedModel | null;
  /**
   * Skills bundled on top of the shared set, as the `import.meta.glob` maps
   * `core/skills/bundled.ts` consumes. Empty maps in the community edition.
   */
  bundledSkills: { skill: Record<string, string>; resources: Record<string, string> };
  /** First-run wizard copy and the optional screens before the key step. */
  setup: {
    /** Sentence(s) under the "Connect your model" heading. */
    intro: string;
    /**
     * Screens shown before the shared steps: a choice of path, sign-in,
     * whatever the edition needs. Omit and the wizard opens on the key step.
     */
    Intro?: ComponentType<SetupIntroProps>;
  };
  /**
   * A section rendered in Settings above the model pickers. Decides its own
   * visibility from the props. Its root element must carry
   * `id="edition-settings"` so the shared tree can scroll to it.
   */
  SettingsSection?: ComponentType<{ apiKey: string | null; currentModelId: string | null }>;
  /** A small status control in the composer toolbar, left of the connector marks. */
  ComposerStatus?: ComponentType<{ onOpenSettings: () => void }>;
  /** Called once by the app root with the services the edition may use. */
  attach?: (services: EditionServices) => void;
}

/** What `@edition` must export. */
export interface EditionModule {
  edition: Edition;
  /**
   * Hook: the hosted rows as synthetic `ModelInfo`s with their live labels
   * and `hosted.locked` set when the user may not run them, for the picker.
   * Returns a stable empty array when there are none.
   */
  useHostedPickerRows(): ModelInfo[];
  /** Hook: ids of the hosted models the user may run right now. Stable when unchanged. */
  useEntitledHostedIds(): ReadonlySet<string>;
}
