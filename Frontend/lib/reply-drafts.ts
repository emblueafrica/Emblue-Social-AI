export function resolveEditableReplyDraft(
  editedDraft: string | undefined,
  generatedDraft: string | undefined,
  backendDraft: string | undefined,
) {
  return editedDraft ?? generatedDraft ?? backendDraft ?? "";
}
