import {
  BaseAgent,
  ExactMessage,
  MessageInitiator,
  Runtime,
} from "@repo/agent-contract";
import { logger } from "@repo/common";
import { HandleMessageCapability } from "@repo/simple-agent-runtime";

interface State {
  [taskId: string]: {
    messages: {
      role: "user" | "assistant" | "system";
      content: string;
    }[];
  };
}

const state: State = {};

export class AgentHandler extends BaseAgent<typeof HandleMessageCapability> {
  readonly id = "meeting-coordinator";
  constructor(runtime: Runtime) {
    super(runtime, [HandleMessageCapability]);
  }

  async onMessage(
    message: ExactMessage<typeof HandleMessageCapability>,
    initiator: MessageInitiator
  ): Promise<void> {
    logger.info("onMessage", message);

    if (message.type === "do") {
      const messages = state[message.taskId]?.messages ?? [];
      messages.push({
        role: "user",
        content: message.params.message,
      });
      state[message.taskId] = {
        messages,
      };

      logger.info("messages", messages);

      // add an artificial 2s delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (messages.length < 2) {
        await this.runtime.sendMessage(
          {
            type: "did",
            status: "needs_clarification",
            taskId: message.taskId,
            clarification: {
              message: `I need more information (original message: ${messages.at(-1)?.content}) (index: ${messages.length}) (taskId: ${message.taskId})`,
            },
          },
          this.getRecipient(initiator)
        );
      } else {
        await this.runtime.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: "Done!",
            },
          },
          this.getRecipient(initiator)
        );
      }
    } else {
      throw new Error("Unsupported message type");
    }
  }
}
