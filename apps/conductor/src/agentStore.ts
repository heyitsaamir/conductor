import { Agent } from "@repo/task-management-interfaces";

const KNOWN_AGENTS: Agent[] = [
  {
    id: "lead-qualification",
    name: "LeadGenerationAgent",
    url: "http://localhost:4000",
  },
];

export interface AgentStore {
  getAll(): Agent[];
  getById(id: string): Agent | undefined;
  getByName(name: string): Agent | undefined;
}

export class MemoryAgentStore implements AgentStore {
  private agents: Agent[];

  constructor(initialAgents: Agent[] = KNOWN_AGENTS) {
    this.agents = [...initialAgents];
  }

  getAll(): Agent[] {
    return [...this.agents];
  }

  getById(id: string): Agent | undefined {
    return this.agents.find((agent) => agent.id === id);
  }

  getByName(name: string): Agent | undefined {
    return this.agents.find((agent) => agent.name === name);
  }
}

// Export a default instance for convenience
export const defaultAgentStore = new MemoryAgentStore();
