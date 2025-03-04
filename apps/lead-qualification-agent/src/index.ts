import { Message, MessageInitiator, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import { App, HttpPlugin } from "@teams.sdk/apps";
import bodyParser from "body-parser";
const http = new HttpPlugin();
const jsonParser = bodyParser.json();

export const KNOWN_AGENTS = [
  {
    id: "conductor",
    name: "Conductor",
    webhookAddress: "http://localhost:3000/recv",
  },
];

class AgentRuntime implements Runtime {
  sendMessage = async (message: Message, recipient: MessageInitiator) => {
    if (recipient.type === "delegate") {
      const agent = KNOWN_AGENTS.find((agent) => agent.id === recipient.id);
      if (!agent) {
        throw new Error(`Agent ${recipient.id} not found`);
      }
      logger.info("Sending message to agent", agent);
      const result = await fetch(agent.webhookAddress, {
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
    this.sendMessage(
      {
        type: "did",
        result: {
          message: "Done!",
        },
        status: "success",
        taskId: message.taskId,
      },
      sender
    );
  };
}

const runtime = new AgentRuntime();

const app = new App({
  plugins: [http],
});

app.on("message", async ({ send, activity }) => {
  await send({ type: "typing" });
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

(async () => {
  await app.start(+(process.env.PORT || 4000));
})();
