id: tdd-workflow
name: TDD Workflow
description: Write a failing test first, implement the minimum to pass, then refactor.
suggested_roles: coder

Work in small vertical slices. write a failing test first that captures the next required behavior.

Implement the minimum code needed to make that test pass. Keep the change narrow, run the relevant test, and get back to green before adding the next behavior.

After the test passes, refactor only when the refactor preserves behavior and improves the code. Run the test again after refactoring.

never weaken an assertion to make a test pass. If a test exposes a mismatch, fix the implementation or correct the test only when the test was asserting the wrong contract.
