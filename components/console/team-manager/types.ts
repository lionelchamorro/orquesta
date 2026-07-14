export type SelectionKind = "agent" | "role" | "new-agent" | "new-role" | null

export interface Selection {
  kind: SelectionKind
  id: string | null
}
