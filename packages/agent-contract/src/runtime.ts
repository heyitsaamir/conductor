import { Message } from "./agentContract";

import { MessageInitiator } from "./agentContract";

interface Runtime {
  sendMessage(message: Message, recipient: MessageInitiator): Promise<void>;
  receiveMessage(message: Message, recipient: MessageInitiator): Promise<void>;
}

export default Runtime;
