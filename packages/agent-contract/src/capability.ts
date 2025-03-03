import { z } from "zod";

export interface Capability<TName extends string, TInput extends z.ZodType> {
  name: TName; // Unique identifier for the tool
  description?: string; // Human-readable description
  inputSchema: {
    // JSON Schema for the tool's parameters
    type: "object";
    properties: TInput; // Tool-specific parameters
  };
}
