import { AzureOpenAIProvider, createAzure } from "@ai-sdk/azure";
import {
  BaseAgent,
  ExactMessage,
  MessageInitiator,
  Runtime,
} from "@repo/agent-contract";
import { logger } from "@repo/common";
import { HandleMessageCapability } from "@repo/simple-agent-runtime";
import { CoreMessage, generateObject } from "ai";
import { z } from "zod";

interface State {
  [taskId: string]: {
    messages: {
      role: "user" | "assistant" | "system";
      content: string;
    }[];
  };
}

const state: State = {};

const meetingDetailsSchema = z.object({
  salesRepName: z.string().describe("The name of the sales representative"),
  salesRepTitle: z.string().describe("The title of the sales representative"),
  clientName: z.string().describe("The name of the client"),
  companyName: z.string().describe("The name of the company"),
  meetingDate: z.string().describe("The date of the meeting"),
  meetingTime: z.string().describe("The time of the meeting"),
  meetingDuration: z.string().describe("The duration of the meeting"),
  meetingUrl: z.string().describe("The URL of the meeting"),
  additionalNotes: z
    .string()
    .optional()
    .describe("Additional notes about the meeting"),
});

// Define the schema for the AI response
const meetingCoordinatorResponseSchema = z.object({
  meetingDetails: meetingDetailsSchema
    .describe("The details of the scheduled meeting")
    .optional(),

  clarificationQuestion: z
    .string()
    .describe("A question to ask the user for more information")
    .optional(),
});

type MeetingCoordinatorResponse = z.infer<
  typeof meetingCoordinatorResponseSchema
>;

export class AgentHandler extends BaseAgent<typeof HandleMessageCapability> {
  readonly id = "meeting-coordinator";
  private openai: AzureOpenAIProvider;

  constructor(runtime: Runtime) {
    super(runtime, [HandleMessageCapability]);
    this.openai = createAzure({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: "2024-10-21",
    });
  }

  async onMessage(
    message: ExactMessage<typeof HandleMessageCapability>,
    initiator: MessageInitiator
  ): Promise<void> {
    logger.debug("onMessage", message);

    if (message.type === "do") {
      const messages = state[message.taskId]?.messages ?? [];
      messages.push({
        role: "user",
        content: message.params.message,
      });
      state[message.taskId] = {
        messages,
      };

      logger.debug("messages", messages);

      // Generate a response using AI
      const aiResponse = await this.generateResponse(messages);
      logger.debug("AI response", aiResponse);

      if (aiResponse.clarificationQuestion) {
        messages.push({
          role: "assistant",
          content: aiResponse.clarificationQuestion,
        });
        await this.runtime.sendMessage(
          {
            type: "did",
            status: "needs_clarification",
            taskId: message.taskId,
            clarification: {
              message: aiResponse.clarificationQuestion,
            },
          },
          this.getRecipient(initiator)
        );
      } else if (aiResponse.meetingDetails) {
        const markdownLines = [];
        markdownLines.push(
          `### Meeting Scheduled: ${aiResponse.meetingDetails.companyName}`
        );
        markdownLines.push(
          `Meeting between **${aiResponse.meetingDetails.salesRepName}** (${aiResponse.meetingDetails.salesRepTitle}) and **${aiResponse.meetingDetails.clientName}** from ${aiResponse.meetingDetails.companyName}`
        );
        markdownLines.push(
          `- **Date**: ${aiResponse.meetingDetails.meetingDate}`
        );
        markdownLines.push(
          `- **Time**: ${aiResponse.meetingDetails.meetingTime}`
        );
        markdownLines.push(
          `- **Duration**: ${aiResponse.meetingDetails.meetingDuration}`
        );
        markdownLines.push(
          `- **Meeting URL**: ${aiResponse.meetingDetails.meetingUrl}`
        );

        if (aiResponse.meetingDetails.additionalNotes) {
          markdownLines.push(
            `\n**Additional Notes**: ${aiResponse.meetingDetails.additionalNotes}`
          );
        }

        const markdownMessage = markdownLines.join("\n");
        messages.push({
          role: "assistant",
          content: markdownMessage,
        });
        await this.runtime.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: markdownMessage,
            },
          },
          this.getRecipient(initiator)
        );
      }
    } else {
      throw new Error("Unsupported message type");
    }
  }

  private async generateResponse(
    messages: { role: string; content: string }[]
  ): Promise<MeetingCoordinatorResponse> {
    const systemPrompt = `You are a meeting coordinator for a B2B SaaS company.
Your primary task is to schedule meetings between sales representatives and clients.

The sales representative's name is required before proceeding. If you don't have it, ask for it first.

Once you have the sales representative's name, you can make up other meeting details:
- Platform: Zoom
- Meeting URL: https://zoom.us/j/{random 11-digit number}
- Meeting dates between tomorrow and 2 weeks from now
- Standard business hours

<RULES>
1. First, confirm the sales representative's name if not provided
2. Once you have the name, propose a meeting time explicitly and ask for confirmation. (e.g. "I propose a meeting on Tuesday at 10am. Does this work for you?")
3. Only mark the meeting as "booked" after receiving explicit confirmation
4. Keep responses brief and focused
</RULES>
`;

    const aiMessages: CoreMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages.map((msg) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      })),
    ];

    logger.debug("messages for generating response", {
      messages: aiMessages,
    });

    try {
      const result = await generateObject({
        model: this.openai("gpt-4o"),
        messages: aiMessages,
        schema: meetingCoordinatorResponseSchema,
      });

      return result.object;
    } catch (error) {
      logger.error("Error generating response", error);
      throw error;
    }
  }
}
