import { Message, MessageInitiator } from "./agentContract";

interface Runtime {
  sendMessage(
    message: Message,
    recipient: MessageInitiator
  ): Promise<string | undefined>;
  receiveMessage(message: Message, sender: MessageInitiator): Promise<void>;
}
export default Runtime;
