import { MessageSendActivity } from "@teams.sdk/api";
import { App, HttpPlugin } from "@teams.sdk/apps";
import { DevtoolsPlugin } from "@teams.sdk/dev";
import bodyParser from "body-parser";
import cors from "cors";

const http = new HttpPlugin();
const jsonParser = bodyParser.json();

const app = new App({
  plugins: [http, new DevtoolsPlugin()],
});

// Configure CORS
http.use(cors());

app.on("message", async ({ send, activity }) => {
  await send({ type: "typing" });
  console.log("message", activity);
  await send(`you said "${activity.text}"`);
});

app.on("install.add", async ({ activity }) => {
  console.log("install.add", activity);
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

(async () => {
  await app.start(+(process.env.PORT || 3000));
})();
