import { MessageSendActivity } from "@microsoft/spark.api";
import { App, HttpPlugin } from "@microsoft/spark.apps";
import { DevtoolsPlugin } from "@microsoft/spark.dev";
import { Message, MessageInitiator, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import bodyParser from "body-parser";
import cors from "cors";
import { ConductorAgent } from "./conductorAgent";
import { KNOWN_AGENTS } from "./constants";

const http = new HttpPlugin();
const jsonParser = bodyParser.json();

const app = new App({
  plugins: [http, new DevtoolsPlugin()],
});

let conductorAgent: ConductorAgent;

const fakeRuntime: Runtime = {
  sendMessage: async (message: Message, recipient: MessageInitiator) => {
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
          "x-sender-id": "conductor",
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
      if (message.type === "do") {
        throw new Error("Unsupported message type");
      }
      switch (message.status) {
        case "success":
          await app.send(recipient.conversationId, {
            type: "message",
            text: message.result.message,
          });
          break;
        case "error":
          await app.send(recipient.conversationId, {
            type: "message",
            text: message.error.message,
          });
          break;
        case "needs_clarification":
          await app.send(recipient.conversationId, {
            type: "message",
            text: message.clarification.message,
          });
          break;
      }
    }
  },
  receiveMessage: async (message: Message, sender: MessageInitiator) => {
    logger.info("receiveMessage", message, sender);
    if (message.type === "do") {
      await conductorAgent.onMessage(message as any, sender);
    } else {
      await conductorAgent.onMessage(message as any, sender);
    }
  },
};

conductorAgent = new ConductorAgent(fakeRuntime);

// Configure CORS
http.use(cors());

app.on("message", async ({ activity }) => {
  await fakeRuntime.receiveMessage(
    {
      type: "do",
      taskId: "123", // For brand new tasks, there is no task id, so we need a constant here
      method: "handleMessage",
      params: {
        message: activity.text,
        conversationId: activity.conversation.id,
      },
    },
    {
      type: "teams",
      conversationId: activity.conversation.id,
    }
  );
});

http.post("/customerFeedback", jsonParser, async (req: any, res: any) => {
  console.log("customerFeedback");
  console.log(req.body);
  const { name, email, summary, reproSteps } = req.body;

  const adaptiveCard = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: "New Customer Feedback",
        weight: "Bolder",
        size: "Large",
        wrap: true,
      },
      {
        type: "FactSet",
        facts: [
          {
            title: "Name",
            value: name,
          },
          {
            title: "Email",
            value: email,
          },
        ],
      },
      {
        type: "TextBlock",
        text: "Issue Summary",
        weight: "Bolder",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: summary,
        wrap: true,
      },
      {
        type: "TextBlock",
        text: "Reproduction Steps",
        weight: "Bolder",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: reproSteps,
        wrap: true,
      },
    ],
  };

  const conversationResource = await app.api.conversations.create({
    isGroup: true,
    channelData: {
      channel: {
        id: "19:1d2b41a25f934efcbc4d442d896c0f43@thread.tacv2",
      },
    },
    activity: {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: adaptiveCard,
        },
      ],
    } as MessageSendActivity,
  });
  await app.send(conversationResource.id, {
    type: "message",
    text: "This works still",
  });
  res.status(200).send("ok");
});

http.post("/channelMessage", jsonParser, async (req: any, res: any) => {
  console.log("channelMessage");
  console.log(req.body);
  res.status(200).send("ok");
});

http.post("/recv", jsonParser, async (req: any, res: any) => {
  const sender: string | undefined = req.headers["x-sender-id"] as string;
  if (!sender) {
    res.status(400).send("x-sender-id header is required");
    return;
  }
  res.status(200).send("ok");
  await fakeRuntime.receiveMessage(req.body, {
    id: sender,
    type: "delegate",
  });
});

(async () => {
  // Pause for 2 seconds, then send a message to the lead qualification agent
  const testSend = async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await fakeRuntime.receiveMessage(
      {
        type: "do",
        taskId: "123",
        method: "handleMessage",
        params: {
          message: "build a web application",
          conversationId:
            "a:1-nplMamMMXmQm_VavY4ZWTJMhYuHDLdqKRi0YqzWY9PKphppVFaI7rOrnj54pvKcTRkSH8-K-xNwhEia3sLFl86LmeTaTfnxLAOJKixU6nBTNTgTQKLsa_zPb1Ju3gq3",
        },
      },
      {
        type: "teams",
        conversationId:
          "a:1-nplMamMMXmQm_VavY4ZWTJMhYuHDLdqKRi0YqzWY9PKphppVFaI7rOrnj54pvKcTRkSH8-K-xNwhEia3sLFl86LmeTaTfnxLAOJKixU6nBTNTgTQKLsa_zPb1Ju3gq3",
      }
    );
  };
  await Promise.all([app.start(+(process.env.PORT || 3000)), testSend()]);
})();
