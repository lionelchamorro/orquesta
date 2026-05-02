# orquesta-build-dag

Use this skill when a human asks you to hand work off to Orquesta night mode.

Produce a Task DAG JSON document and submit it to the daemon with:

```sh
curl -X POST http://localhost:8000/api/runs \
  -H "Content-Type: application/json" \
  -d @orquesta-run.json
```

The document shape is:

```json
{
  "prompt": "Original user goal",
  "max_iterations": 2,
  "tasks": [
    {
      "id": "task-a",
      "title": "Short imperative title",
      "description": "Specific acceptance criteria and files to touch",
      "depends_on": []
    }
  ]
}
```

Rules:

- `tasks` must be a DAG.
- `id` must start with a lowercase letter and contain only lowercase letters, digits, and dashes.
- `depends_on` must reference existing task IDs.
- Keep tasks vertical and independently reviewable.
- Put implementation, tests, and verification expectations in each task description.
- Do not include concurrent-run, remote-registry, or cross-account fallback work unless the user explicitly asks for a later plan.
