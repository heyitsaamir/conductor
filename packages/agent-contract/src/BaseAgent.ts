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

    logger.debug(`Message validation ${isValid ? "succeeded" : "failed"}`, {
      class: this.constructor.name,
      method: "validateMessage",
      messageType: message.type,
      capability: "method" in message ? message.method : undefined,
      taskId: message.taskId,
      capabilities: this.capabilities.map((c) => c.name),
    });

    return isValid;
  }

  protected getRecipient(initiator: MessageInitiator): MessageInitiator {
    const recipient: MessageInitiator =
      initiator.type === "teams"
        ? { type: "teams" as const, conversationId: initiator.conversationId }
        : { type: "delegate" as const, url: initiator.url };

    logger.debug(`Calculated recipient for message`, {
      class: this.constructor.name,
      method: "getRecipient",
      recipientType: recipient.type,
      ...("conversationId" in recipient
        ? { conversationId: recipient.conversationId }
        : { url: recipient.url }),
    });

    return recipient;
  }
}

export default BaseAgent;
