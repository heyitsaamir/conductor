import { Agent } from "@repo/task-management-interfaces";

type AgentWithMembership = Agent & {
  description: string;
  channelMembership: string[];
};

const KNOWN_AGENTS: AgentWithMembership[] = [
  {
    id: "lead-qualification",
    name: "Design Agent",
    description: "A design agent that designs UI/UX mockups",
    url: "http://localhost:4000",
    channelMembership: [
      "19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2",
    ],
  },
  {
    id: "lead-qualification",
    name: "Project Structure Agent",
    description: "Can set up project structure for a webapp",
    url: "http://localhost:4000",
    channelMembership: [
      "19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2",
    ],
  },
  {
    id: "lead-qualification",
    name: "Frontend Agent",
    description: "Can implement frontend components for a webapp",
    url: "http://localhost:4000",
    channelMembership: [
      "19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2",
    ],
  },
  {
    id: "lead-qualification",
    name: "Backend Agent",
    description: "Can implement backend API for a webapp",
    url: "http://localhost:4000",
    channelMembership: [
      "19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2",
    ],
  },
  {
    id: "lead-qualification",
    name: "Testing Agent",
    description: "Can write tests for a webapp",
    url: "http://localhost:4000",
    channelMembership: [
      "19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2",
    ],
  },
];

export interface AgentStore {
  getAll(channelOrConversationId?: string): AgentWithMembership[];
  getById(id: string): AgentWithMembership | undefined;
  getByName(name: string): AgentWithMembership | undefined;
}

export class MemoryAgentStore implements AgentStore {
  private agents: AgentWithMembership[];

  constructor(initialAgents: AgentWithMembership[] = KNOWN_AGENTS) {
    this.agents = [...initialAgents];
  }

  getAll(channelOrConversationId?: string): AgentWithMembership[] {
    let channelId: string | undefined;
    if (channelOrConversationId) {
      if (channelOrConversationId.includes("messageid")) {
        // Extract the channel id from the conversation id which looks like "'19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2;messageid=1741220636000'"
        channelId = channelOrConversationId.split(";")[0];
      } else {
        channelId = channelOrConversationId;
      }
    }
    if (!channelId) {
      return [...this.agents];
    }

    return this.agents.filter((agent) =>
      agent.channelMembership.includes(channelId)
    );
  }

  getById(id: string): AgentWithMembership | undefined {
    return this.agents.find((agent) => agent.id === id);
  }

  getByName(name: string): AgentWithMembership | undefined {
    return this.agents.find((agent) => agent.name === name);
  }
}

// Export a default instance for convenience
export const defaultAgentStore = new MemoryAgentStore();
