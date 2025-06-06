import { AzureOpenAIProvider, createAzure } from "@ai-sdk/azure";
import { ActivityLike } from "@microsoft/teams.api";
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
    .nullable()
    .describe("Additional notes about the meeting"),
});

// Define the schema for the AI response
const meetingCoordinatorResponseSchema = z.object({
  meetingDetails: meetingDetailsSchema
    .describe("The details of the scheduled meeting")
    .optional()
    .nullable(),

  clarificationQuestion: z
    .string()
    .describe("A question to ask the user for more information")
    .optional()
    .nullable(),
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
        let plainTextMessage = `Meeting Scheduled: ${aiResponse.meetingDetails.companyName}\n`;
        plainTextMessage += `Meeting between ${aiResponse.meetingDetails.salesRepName} (${aiResponse.meetingDetails.salesRepTitle}) and ${aiResponse.meetingDetails.clientName}\n`;
        plainTextMessage += `Date: ${aiResponse.meetingDetails.meetingDate}\n`;
        plainTextMessage += `Time: ${aiResponse.meetingDetails.meetingTime}\n`;
        plainTextMessage += `Duration: ${aiResponse.meetingDetails.meetingDuration}\n`;
        plainTextMessage += `Meeting URL: ${aiResponse.meetingDetails.meetingUrl}`;
        if (aiResponse.meetingDetails.additionalNotes) {
          plainTextMessage += `\nAdditional Notes: ${aiResponse.meetingDetails.additionalNotes}`;
        }

        const activity: ActivityLike & { plainTextMessage: string } = {
          type: "message",
          plainTextMessage,
          attachments: [
            {
              contentType: "application/vnd.microsoft.card.adaptive",
              content: {
                type: "AdaptiveCard",
                $schema: "https://adaptivecards.io/schemas/adaptive-card.json",
                version: "1.5",
                body: [
                  {
                    type: "TextBlock",
                    text: `Meeting Scheduled: ${aiResponse.meetingDetails.companyName}`,
                    size: "Large",
                    weight: "Bolder",
                    wrap: true,
                  },
                  {
                    type: "TextBlock",
                    text: `Meeting between ${aiResponse.meetingDetails.salesRepName} (${aiResponse.meetingDetails.salesRepTitle}) and ${aiResponse.meetingDetails.clientName}`,
                    wrap: true,
                    spacing: "Medium",
                  },
                  {
                    type: "FactSet",
                    facts: [
                      {
                        title: "Date",
                        value: aiResponse.meetingDetails.meetingDate,
                      },
                      {
                        title: "Time",
                        value: aiResponse.meetingDetails.meetingTime,
                      },
                      {
                        title: "Duration",
                        value: aiResponse.meetingDetails.meetingDuration,
                      },
                      {
                        title: "Meeting URL",
                        value: aiResponse.meetingDetails.meetingUrl,
                      },
                      ...(aiResponse.meetingDetails.additionalNotes
                        ? [
                            {
                              title: "Additional Notes",
                              value: aiResponse.meetingDetails.additionalNotes,
                            },
                          ]
                        : []),
                    ],
                  },
                ],
              },
            },
          ],
        };

        messages.push({
          role: "assistant",
          content: JSON.stringify(activity),
        });

        await this.runtime.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: JSON.stringify(activity),
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

Today's date is ${new Date().toISOString().split("T")[0]}.

<RULES>
1. First, confirm the sales representative's name if not provided
2. Once you have the name, propose a meeting time explicitly and ask for confirmation. (e.g. "I propose a meeting on Tuesday at 10am. Does this work for you?")
3. do NOT ask for the appointment slots from the user. You already have all this information (just make it up).
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
