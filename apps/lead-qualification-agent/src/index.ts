import { App, HttpPlugin } from "@microsoft/spark.apps";
import { Message, MessageInitiator, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import bodyParser from "body-parser";
const http = new HttpPlugin();
const jsonParser = bodyParser.json();

export const KNOWN_AGENTS = [
  {
    id: "conductor",
    name: "Conductor",
    url: "http://localhost:3000",
  },
];

interface State {
  [taskId: string]: {
    messages: {
      role: "user" | "assistant" | "system";
      content: string;
    }[];
  };
}

const state: State = {};

class AgentRuntime implements Runtime {
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
          "x-sender-id": "lead-qualification",
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
    } else {
      throw new Error("Unsupported recipient type");
    }
  };
  receiveMessage = async (message: Message, sender: MessageInitiator) => {
    logger.info("receiveMessage", message);
    if (message.type === "do") {
      const messages = state[message.taskId]?.messages ?? [];
      messages.push({
        role: "user",
        content: message.params!.message,
      });
      state[message.taskId] = {
        messages,
      };
      logger.info("messages", messages);
      if (messages.length < 2) {
        this.sendMessage(
          {
            type: "did",
            status: "needs_clarification",
            taskId: message.taskId,
            clarification: {
              message: `I need more information (original message: ${messages.at(-1)?.content}) (index: ${messages.length}) (taskId: ${message.taskId})`,
            },
          },
          sender
        );
      } else {
        this.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: "Done!",
            },
          },
          sender
        );
      }
    } else {
      throw new Error("Unsupported message type");
    }
  };
}

const runtime = new AgentRuntime();

const app = new App({
  plugins: [http],
});

app.on("message", async ({ send, activity }) => {
  await send({ type: "typing" });
  console.log("message", activity);
  await send(`you said "${activity.text}"`);
});

http.post("/recv", jsonParser, async (req, res) => {
  const sender: string | undefined = req.headers["x-sender-id"] as string;
  if (!sender) {
    res.status(400).send("x-sender-id header is required");
    return;
  }
  await runtime.receiveMessage(req.body, {
    id: sender,
    type: "delegate",
  });
  res.send("ok");
});

http.post("/sendAsTeamsMessage", jsonParser, async (req, res) => {
  logger.info("sendAsTeamsMessage", req.body);
  const { message, conversationId } = req.body;
  if (!message) {
    res.status(400).send("message is required");
    return;
  }
  await app.send(conversationId, {
    type: "message",
    text: message,
  });
  res.send("ok");
});

(async () => {
  await app.start(+(process.env.PORT || 4000));
})();
