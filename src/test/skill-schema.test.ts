import { expect, test } from "bun:test";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { RunSubmissionSchema } from "../core/schemas";

test("build-dag schema accepts the same minimal payload as RunSubmissionSchema", async () => {
  const schema = await Bun.file(new URL("../../templates/build-dag-skill/dag-schema.json", import.meta.url)).json();
  expect(schema.properties.tasks.minItems).toBe(1);
  expect(schema.properties.tasks.items.properties.id.pattern).toBe("^[a-z][a-z0-9-]*$");
  expect(RunSubmissionSchema.safeParse({ tasks: [{ id: "task-a", title: "A" }] }).success).toBe(true);
  expect(RunSubmissionSchema.safeParse({ tasks: [{ id: "Task A", title: "A" }] }).success).toBe(false);
});

test("build-dag skill endpoints are public", async () => {
  const store = new PlanStore(process.cwd());
  const handler = createHttpHandler({
    root: process.cwd(),
    store,
    pool: { write() {}, kill() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
    sessionToken: "secret",
  });

  const skill = await handler(new Request("http://localhost/api/skill/build-dag"));
  const schema = await handler(new Request("http://localhost/api/skill/build-dag/schema"));

  expect(skill.status).toBe(200);
  expect(await skill.text()).toContain("orquesta-build-dag");
  expect(schema.status).toBe(200);
  expect(await schema.json()).toHaveProperty("title", "Orquesta Run Submission");
});
