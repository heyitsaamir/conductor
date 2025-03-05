import { Capability } from "@repo/agent-contract";
import { z } from "zod";

export const HandleMessageSchema = z.object({
  message: z.string(),
});

export const HandleMessageCapability: Capability<
  "handleMessage",
  typeof HandleMessageSchema
> = {
  name: "handleMessage",
  description: "Capability for handling messages",
  inputSchema: {
    type: "object",
    properties: HandleMessageSchema,
  },
};

export type HandleMessageParams = z.infer<typeof HandleMessageSchema>;
