import { Agent } from "@repo/task-management-interfaces";

export const KNOWN_AGENTS: Agent[] = [
  {
    id: "lead-qualification",
    name: "Lead Qualification",
    webhookAddress: "http://localhost:4000/recv",
  },
];
