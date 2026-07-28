import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { WorkflowsController } from "./controllers.js";

const step = (name: string, id?: string) => ({
  ...(id ? { id } : {}),
  name,
  type: "SSH" as const,
  credentialId: "credential-1",
  timeoutMs: 30_000,
  retries: 0,
  continueOnFailure: false,
  config: {
    host: "192.168.88.129",
    port: 22,
    username: "root",
    command: "docker restart NapCat",
  },
});

const body = (steps = [step("reboot", "step-1")]) => ({
  name: "Recovery",
  monitorId: "monitor-1",
  trigger: "DOWN" as const,
  approvalMode: "AUTO" as const,
  approvalTimeoutMinutes: 15,
  version: 1,
  steps,
});

function setup(
  existingSteps: Array<{ id: string; position: number; _count: { stepRuns: number } }>,
) {
  const tx = {
    workflow: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    workflowStep: {
      findMany: vi.fn().mockResolvedValue(existingSteps),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi
        .fn()
        .mockRejectedValue(new Error("Foreign key constraint failed")),
    },
  };
  const prisma = {
    credential: {
      findUnique: vi.fn().mockResolvedValue({ type: "SSH_KEY" }),
    },
    workflow: {
      findUnique: vi.fn().mockResolvedValue({ id: "workflow-1", version: 2 }),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const controller = new WorkflowsController(prisma as never, {} as never);
  return { controller, tx };
}

describe("workflow updates with execution history", () => {
  it("updates an existing referenced step without replacing its id", async () => {
    const { controller, tx } = setup([
      { id: "step-1", position: 0, _count: { stepRuns: 2 } },
    ]);

    await expect(controller.update("workflow-1", body())).resolves.toMatchObject({
      id: "workflow-1",
      version: 2,
    });
    expect(tx.workflowStep.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "step-1" } }),
    );
    expect(tx.workflowStep.deleteMany).not.toHaveBeenCalled();
  });

  it("returns a conflict when removing a step referenced by run history", async () => {
    const { controller } = setup([
      { id: "step-1", position: 0, _count: { stepRuns: 0 } },
      { id: "step-2", position: 1, _count: { stepRuns: 1 } },
    ]);

    await expect(controller.update("workflow-1", body())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
