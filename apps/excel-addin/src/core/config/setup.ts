/**
 * Setup is done once the user has picked a model. A pick without a key is
 * not a dead end: the choice is kept and waits for a key (see
 * `ui/taskpane/pending-model`), and an edition may run a hosted model in
 * the meantime. The key parameter stays in the signature so call sites read
 * the same; it gates nothing.
 */
export function isSetupComplete(
  _apiKey: string | null | undefined,
  modelId: string | null | undefined
): boolean {
  return Boolean(modelId);
}
