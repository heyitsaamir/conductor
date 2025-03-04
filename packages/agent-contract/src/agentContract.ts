import { z } from "zod";
import { Capability } from "./capability";
// Request schema definition
export const DoRequestSchema = z.intersection(
  z.object({
    type: z.literal("do"),
    taskId: z.string(),
  }),
  z.object({
    method: z.string(),
    params: z.record(z.any()).optional(),
  })
);

export const CapabilityDoRequest = (capability: Capability<any, any>) => {
  return z.intersection(
    DoRequestSchema,
    z.object({
      method: z.literal(capability.name),
      params: capability.inputSchema.properties,
    })
  );
};

// Weird hack you need to do to prevert splitting up T["name"] and T["inputSchema"]["properties"]
// when T is a union of capabilities
type CapabilityTransformedForDoRequest<T extends Capability<any, any>> =
  T extends any
    ? {
        method: T["name"];
        params: z.infer<T["inputSchema"]["properties"]>;
      }
    : never;

type CapabilityDoRequestType<T extends Capability<any, any>> = Omit<
  z.infer<typeof DoRequestSchema>,
  "method" | "params"
> &
  CapabilityTransformedForDoRequest<T>;

// Result schema definitions
const ErrorSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});

const ResultSchema = z
  .object({
    message: z.string().optional(),
  })
  .catchall(z.unknown());

const ClarificationSchema = z.object({
  message: z.string(),
});

export const DidRequestSchema = z.intersection(
  z.object({
    type: z.literal("did"),
  }),
  z.discriminatedUnion("status", [
    z.object({
      status: z.literal("error"),
      error: ErrorSchema,
      taskId: z.string(),
    }),
    z.object({
      status: z.literal("success"),
      result: ResultSchema,
      taskId: z.string(),
    }),
    z.object({
      status: z.literal("needs_clarification"),
      taskId: z.string(),
      clarification: ClarificationSchema,
    }),
  ])
);

export type DoRequest = z.infer<typeof DoRequestSchema>;
export type DidRequest = z.infer<typeof DidRequestSchema>;

export const MessageSchema = z.union([DoRequestSchema, DidRequestSchema]);
export type Message = z.infer<typeof MessageSchema>;

export const ExactMessageSchema = <T extends Capability<any, any>>(
  capability: T
) => {
  return z.union([CapabilityDoRequest(capability), DidRequestSchema]);
};
export type ExactMessage<T extends Capability<any, any>> =
  | CapabilityDoRequestType<T>
  | z.infer<typeof DidRequestSchema>;

interface DelegatedInitiator {
  type: "delegate";
  id: string;
}

interface TeamsInitiator {
  type: "teams";
  conversationId: string;
}
export type MessageInitiator = DelegatedInitiator | TeamsInitiator;
