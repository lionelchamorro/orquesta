"use client"

import type { SkillSummary } from "@/lib/types"

interface SkillsPickerProps {
  skills: SkillSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  /** Prefix used to generate unique checkbox ids, e.g. "role-coder-skill" */
  labelPrefix: string
}

export function SkillsPicker({ skills, selected, onChange, labelPrefix }: SkillsPickerProps) {
  if (skills.length === 0) return null

  function toggle(skillId: string) {
    onChange(
      selected.includes(skillId)
        ? selected.filter((s) => s !== skillId)
        : [...selected, skillId],
    )
  }

  return (
    <fieldset className="rounded-lg border border-border bg-card p-3">
      <legend className="px-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        Skills
      </legend>
      <div className="flex flex-wrap gap-2 pt-1">
        {skills.map((skill) => {
          const checkId = `${labelPrefix}-${skill.id}`
          const isChecked = selected.includes(skill.id)
          return (
            <label
              key={skill.id}
              htmlFor={checkId}
              title={skill.description}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                isChecked
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <input
                id={checkId}
                type="checkbox"
                checked={isChecked}
                onChange={() => toggle(skill.id)}
                className="sr-only"
              />
              {skill.name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
