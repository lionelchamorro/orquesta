const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Orquesta Run Submission",
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string", default: "" },
    runId: { type: "string", minLength: 1 },
    prd: { type: "string", default: "(prompt)" },
    max_iterations: { type: "integer", minimum: 1 },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
          title: { type: "string", minLength: 1 },
          description: { type: "string" },
          depends_on: {
            type: "array",
            default: [],
            items: { type: "string", pattern: "^[a-z][a-z0-9-]*$" },
          },
        },
      },
    },
  },
  required: ["tasks"],
};

await Bun.write(
  new URL("../templates/build-dag-skill/dag-schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
);
