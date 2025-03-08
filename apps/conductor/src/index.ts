import {
  ActivityLike,
  MentionEntity,
  MessageSendActivity,
} from "@microsoft/spark.api";
import { App, HttpPlugin } from "@microsoft/spark.apps";
import { DevtoolsPlugin } from "@microsoft/spark.dev";
import { Message, MessageInitiator, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import bodyParser from "body-parser";
import cors from "cors";
import { defaultAgentStore } from "./agentStore";
import { ConductorAgent } from "./conductorAgent";

const http = new HttpPlugin();
const jsonParser = bodyParser.json();

const app = new App({
  plugins: [http, new DevtoolsPlugin()],
});

let conductorAgent: ConductorAgent;

const fakeRuntime: Runtime = {
  sendMessage: async (message: Message, recipient: MessageInitiator) => {
    if (recipient.type === "delegate") {
      const agent = defaultAgentStore.getById(recipient.id);
      if (!agent) {
        throw new Error(`Agent ${recipient.id} not found`);
      }
      logger.debug("Sending message to agent", agent);
      const result = await fetch(`${agent.url}/recv`, {
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
      let textToSend: string | undefined;
      switch (message.status) {
        case "success":
          textToSend = message.result.message;
          break;
        case "error":
          textToSend = message.error.message;
          break;
        case "needs_clarification":
          textToSend = message.clarification.message;
          break;
      }
      if (textToSend) {
        if (recipient.byAgentId) {
          const agent = defaultAgentStore.getById(recipient.byAgentId);
          if (!agent) {
            throw new Error(`Agent ${recipient.byAgentId} not found`);
          }
          logger.debug("Sending message to agent", {
            agentUrl: agent.url,
            message: textToSend,
            conversationId: recipient.conversationId,
          });
          const result = await fetch(`${agent.url}/sendAsTeamsMessage`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-sender-id": "conductor",
            },
            body: JSON.stringify({
              message: textToSend,
              conversationId: recipient.conversationId,
            }),
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
          // TODO: Remove this ugly hack to send complex activitie to teams
          let activity: ActivityLike;
          if (textToSend.startsWith("{") && textToSend.endsWith("}")) {
            activity = JSON.parse(textToSend) as ActivityLike;
          } else {
            activity = {
              type: "message",
              text: textToSend,
            };
          }
          await app.send(recipient.conversationId, activity);
        }
      }
    }
  },
  receiveMessage: async (message: Message, sender: MessageInitiator) => {
    logger.debug("receiveMessage", message, sender);
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

const prepareActivityText = (activity: string) => {
  return activity.replace(/^<at>[^<]+<\/at>/g, "").trim();
};

const receiveMessageFromTeams = async (
  activityText: string,
  conversationId: string
) => {
  const text = prepareActivityText(activityText);
  await fakeRuntime.receiveMessage(
    {
      type: "do",
      taskId: "123", // For brand new tasks, there is no task id, so we need a constant here
      method: "handleMessage",
      params: {
        message: text,
        conversationId: conversationId,
      },
    },
    {
      type: "teams",
      conversationId: conversationId,
    }
  );
};

app.on("message", async ({ activity }) => {
  logger.debug("Receive message from teams", activity);
  await receiveMessageFromTeams(activity.text, activity.conversation.id);
});

app.on("card.action", async ({ activity, send }) => {
  logger.debug("Receive card action from teams", activity);
  const taskId: string | undefined = activity.value.action.data.taskId;
  if (!taskId) {
    logger.warn("No task id found in card action");
    return {
      type: "application/vnd.microsoft.activity.message",
      value: "No task id found in card action",
      status: 200,
    };
  }

  const action = activity.value.action.verb;
  if (action === "approve") {
    await receiveMessageFromTeams("Approved task", activity.conversation.id);
  } else if (action === "deny") {
    await send({
      type: "message",
      text: "Sounds good. Marking the task as cancelled.",
    });
    // TODO: Conductor agent should handle this.
  } else {
    logger.warn("Unknown action", action);
  }
  return {
    status: 200,
    type: "application/vnd.microsoft.activity.message",
    value: "Got it!",
  };
});

http.post("/leads", jsonParser, async (req: any, res: any) => {
  console.log("new lead received");
  console.log(req.body);
  const { name, email, company, details, phoneNumber } = req.body;

  // Send notification message about the new lead
  const leadMessage = `A new lead messaged! Details:\nName: ${name}\nCompany: ${company}\nTheir message: ${details}`;

  const adaptiveCard = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: "New Lead",
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
            title: "Company",
            value: company,
          },
          {
            title: "Email",
            value: email,
          },
          {
            title: "Phone",
            value: phoneNumber,
          },
        ],
      },
      {
        type: "TextBlock",
        text: "Message",
        weight: "Bolder",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: details,
        wrap: true,
      },
    ],
  };

  const conversationResource = await app.api.conversations.create({
    isGroup: true,
    channelData: {
      channel: {
        id: "19:1362e88b30ec46afb0c1638248ceaac3@thread.tacv2",
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

  await receiveMessageFromTeams(leadMessage, conversationResource.id);
  res.status(200).send("ok");
});

/**
 * Example body (this is for the main conversation post in a channel)
 * {
  '@odata.context': "https://graph.microsoft.com/v1.0/$metadata#teams('345b198c-159d-4291-b7f2-deb8aa311b58')/channels('19%3AsdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1%40thread.tacv2')/messages/$entity",
  id: '1741207930461',
  replyToId: '1741207930461',
  etag: '1741207930461',
  messageType: 'message',
  createdDateTime: '2025-03-05T20:52:10.461Z',
  lastModifiedDateTime: '2025-03-05T20:52:10.461Z',
  lastEditedDateTime: null,
  deletedDateTime: null,
  subject: 'New post 3',
  summary: null,
  chatId: null,
  importance: 'normal',
  locale: 'en-us',
  webUrl: 'https://teams.microsoft.com/l/message/19%3AsdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1%40thread.tacv2/1741207930461?groupId=345b198c-159d-4291-b7f2-deb8aa311b58&tenantId=36f749a1-4343-4fe1-8c10-3607afa94209&createdTime=1741207930461&parentMessageId=1741207930461',
  policyViolation: null,
  eventDetail: null,
  from: {
    application: null,
    device: null,
    user: {
      '@odata.type': '#microsoft.graph.teamworkUserIdentity',
      id: 'd4851876-1c70-4f6e-bfbc-8b2ceeccc8d3',
      displayName: 'Aamir Jawaid',
      userIdentityType: 'aadUser',
      tenantId: '36f749a1-4343-4fe1-8c10-3607afa94209'
    }
  },
  body: {
    contentType: 'html',
    content: '<p>Test</p>',
    plainTextContent: 'Test'
  },
  channelIdentity: {
    teamId: '345b198c-159d-4291-b7f2-deb8aa311b58',
    channelId: '19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2'
  },
  attachments: [],
  mentions: [],
  reactions: [],
  messageLink: 'https://teams.microsoft.com/l/message/19%3AsdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1%40thread.tacv2/1741207930461?groupId=345b198c-159d-4291-b7f2-deb8aa311b58&tenantId=36f749a1-4343-4fe1-8c10-3607afa94209&createdTime=1741207930461&parentMessageId=1741207930461',
  threadType: 'channel',
  teamId: '345b198c-159d-4291-b7f2-deb8aa311b58',
  channelId: '19:sdTGyVjSon7lSr5XQ5944t_LWPc3OQKK48eke2ogJZE1@thread.tacv2'
}
 */
http.post("/channelMessage", jsonParser, async (req: any, res: any) => {
  const {
    replyToId: parentMessageId,
    body,
    channelId,
    from,
    mentions,
  }: {
    replyToId: string;
    body?: { content: string; plainTextContent: string };
    channelId: string;
    from: { user: { id: string } } | null;
    mentions: MentionEntity[];
  } = req.body;
  if (body == null) {
    logger.debug("Ignore message with no body");
    res.status(200).send("ok");
    return;
  }

  if (body.plainTextContent === "") {
    logger.debug("Ignore message with empty content");
    res.status(200).send("ok");
    return;
  }

  const { plainTextContent } = body;

  if (from?.user == null) {
    logger.info("Ignore message from bot");
    // ignore messages from bots for now
    res.status(200).send("ok");
    return;
  }
  logger.debug("Receive channel message", req.body);
  if (mentions.length > 0) {
    logger.warn("Ignoring message with mentions", {
      mentions,
      channelId,
      parentMessageId,
    });
    res.status(200).send("ok");
    return;
  }

  const conversationId = `${channelId};messageid=${parentMessageId}`;
  const activityText = prepareActivityText(plainTextContent);
  await receiveMessageFromTeams(activityText, conversationId);
  res.status(200).send("ok");
});

http.post("/recv", jsonParser, async (req: any, res: any) => {
  const sender: string | undefined = req.headers["x-sender-id"] as string;
  if (!sender) {
    res.status(400).send("x-sender-id header is required");
    return;
  }
  res.status(200).send("ok");
  logger.debug("Receive message from agent", {
    sender,
    message: req.body,
  });
  await fakeRuntime.receiveMessage(req.body, {
    id: sender,
    type: "delegate",
  });
});

(async () => {
  await app.start(+(process.env.PORT || 3000));
})();
