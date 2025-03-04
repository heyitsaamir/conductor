import { Message, Runtime } from "@repo/agent-contract";
import { App } from "@teams.sdk/apps";
import { DevtoolsPlugin } from "@teams.sdk/dev";

const runtime: Runtime = {
  sendMessage: async (message: Message) => {
    console.log("sendMessage", message);
  },
  receiveMessage: async (message: Message) => {
    console.log("receiveMessage", message);
  },
};

const app = new App({
  plugins: [new DevtoolsPlugin()],
});

app.on("message", async ({ send, activity }) => {
  await send({ type: "typing" });
  await send(`you said "${activity.text}"`);
});

(async () => {
  await app.start(+(process.env.PORT || 4000));
})();
