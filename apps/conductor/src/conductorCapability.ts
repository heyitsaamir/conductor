import { Capability } from "@repo/agent-contract";
import { z } from "zod";

const ConductorInput = z.object({
  message: z.string(),
});

export type ConductorInputType = z.infer<typeof ConductorInput>;

export const conductor: Capability<"conductor", typeof ConductorInput> = {
  name: "conductor",
  description: "Conduct a task",
  inputSchema: {
    type: "object",
    properties: ConductorInput,
  },
};
