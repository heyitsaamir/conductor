import {
  BaseAgent,
  Capability,
  Message,
  MessageInitiator,
  Runtime,
} from "@repo/agent-contract";
import { logger } from "@repo/common";
import { KNOWN_AGENTS } from "./constants";

export class AgentRuntime implements Runtime {
  public readonly agentHandler: BaseAgent<Capability<any, any>>;
  constructor(
    agentHandlerFactory: (runtime: Runtime) => BaseAgent<Capability<any, any>>
  ) {
    this.agentHandler = agentHandlerFactory(this);
  }

  sendMessage = async (message: Message, recipient: MessageInitiator) => {
    if (recipient.type === "delegate") {
      const agent = KNOWN_AGENTS.find((agent) => agent.id === recipient.id);
      if (!agent) {
        throw new Error(`Agent ${recipient.id} not found`);
      }
      logger.info("Sending message to agent", agent);
      const result = await fetch(`${agent.url}/recv`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sender-id": this.agentHandler.id,
        },
        body: JSON.stringify(message),
      });
      if (!result.ok) {
        logger.error("Failed to send message to agent", {
          agent: agent.id,
          message: message,
          status: result.status,
          statusText: result.statusText,
        });
      }
      logger.info("Message sent to agent", {
        agent: agent.id,
        message: message,
        status: result.status,
        statusText: result.statusText,
      });
    } else {
      throw new Error("Unsupported recipient type");
    }

    return undefined;
  };

  receiveMessage = async (message: Message, sender: MessageInitiator) => {
    logger.info("receiveMessage", message);

    if (this.agentHandler.validateMessage(message)) {
      await this.agentHandler.onMessage(message, sender);
    } else {
      throw new Error("Invalid message format");
    }
  };
}
