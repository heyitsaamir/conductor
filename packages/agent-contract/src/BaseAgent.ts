import { logger } from "@repo/common";
import Agent from "./agent";
import {
  ExactMessage,
  ExactMessageSchema,
  Message,
  MessageInitiator,
} from "./agentContract";
import { Capability } from "./capability";
import Runtime from "./runtime";

abstract class BaseAgent<T extends Capability<any, any>> implements Agent<T> {
  abstract readonly id: string;

  constructor(
    protected readonly runtime: Runtime,
    protected readonly capabilities: T[]
  ) {}

  onMessage(
    message: ExactMessage<T>,
    _initiator: MessageInitiator
  ): Promise<void> {
    logger.info(
      `Base agent received ${message.type} message for task ${message.taskId}`,
      {
        class: this.constructor.name,
        method: "onMessage",
        messageType: message.type,
        capability: "method" in message ? message.method : undefined,
        taskId: message.taskId,
      }
    );
    throw new Error("Method not implemented.");
  }

  validateMessage(message: Message): message is ExactMessage<T> {
    const isValid = this.capabilities.some(
      (capability) => ExactMessageSchema(capability).safeParse(message).success
    );

    if (!isValid) {
      logger.error("Invalid message", {
        class: this.constructor.name,
        method: "validateMessage",
        messageType: message.type,
        capability: "method" in message ? message.method : undefined,
        taskId: message.taskId,
        capabilities: this.capabilities.map((c) => c.name),
      });

      this.capabilities.some((capability) =>
        ExactMessageSchema(capability).parse(message)
      );
    }

    return isValid;
  }

  protected getRecipient(initiator: MessageInitiator): MessageInitiator {
    const recipient: MessageInitiator =
      initiator.type === "teams"
        ? { type: "teams" as const, conversationId: initiator.conversationId }
        : { type: "delegate" as const, id: initiator.id };

    logger.debug(`Calculated recipient for message`, {
      class: this.constructor.name,
      method: "getRecipient",
      recipientType: recipient.type,
      ...("conversationId" in recipient
        ? { conversationId: recipient.conversationId }
        : { id: recipient.id }),
    });

    return recipient;
  }
}

export default BaseAgent;
