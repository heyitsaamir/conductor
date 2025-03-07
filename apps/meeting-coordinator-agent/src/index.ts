import { App, HttpPlugin } from "@microsoft/spark.apps";
import { logger } from "@repo/common";
import { AgentRuntime } from "@repo/simple-agent-runtime";
import bodyParser from "body-parser";
import { AgentHandler } from "./agentHandler";

const http = new HttpPlugin();
const jsonParser = bodyParser.json();

// AgentRuntime has been moved to agentRuntime.ts
const runtime = new AgentRuntime((runtime) => new AgentHandler(runtime));

const app = new App({
  plugins: [http],
});

app.on("message", async ({ activity }) => {
  logger.warn(
    "message received, but ignoring. Talk directly to conductor",
    activity
  );
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
  logger.debug("sendAsTeamsMessage", req.body);
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
