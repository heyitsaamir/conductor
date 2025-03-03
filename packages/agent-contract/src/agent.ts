import { ExactMessage, Message, MessageInitiator } from "./agentContract";
import { Capability } from "./capability";

interface Agent<T extends Capability<any, any>> {
  onMessage(
    message: ExactMessage<T>,
    initiator: MessageInitiator
  ): Promise<void>;
  validateMessage(message: Message): message is ExactMessage<T>;
}

export default Agent;
