import { AzureOpenAIProvider, createAzure } from "@ai-sdk/azure";
import { ActivityLike } from "@microsoft/spark.api";
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

const assessmentSchema = z.object({
  companyName: z.string().describe("The name of the company"),
  companyDescription: z.string().describe("A description of the company"),
  companySize: z.number().describe("The size of the company"),
  companyIndustry: z.string().describe("The industry of the company"),
  companyMainProduct: z.string().describe("The main product of the company"),
  companyRevenue: z.number().describe("The revenue of the company"),
  companyFounded: z.number().describe("The year the company was founded"),
  companyLocation: z.string().describe("The location of the company"),
  companyCEO: z.string().describe("The CEO of the company"),
});

// Define the schema for the AI response
const leadQualificationResponseSchema = z.object({
  assessment: assessmentSchema
    .describe("The assessment of the lead")
    .optional()
    .nullable(),
  clarificationQuestion: z
    .string()
    .describe("A question to ask the user for more information.")
    .optional()
    .nullable(),
});

type LeadQualificationResponse = z.infer<
  typeof leadQualificationResponseSchema
>;

export class AgentHandler extends BaseAgent<typeof HandleMessageCapability> {
  readonly id = "lead-qualification";
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

      if (aiResponse.assessment) {
        let plainTextMessage = `Assessment for ${aiResponse.assessment.companyName}`;
        if (aiResponse.assessment.companyDescription) {
          plainTextMessage += `Description: ${aiResponse.assessment.companyDescription}`;
        }
        if (aiResponse.assessment.companySize) {
          plainTextMessage += `Size: ${aiResponse.assessment.companySize}`;
        }
        if (aiResponse.assessment.companyIndustry) {
          plainTextMessage += `Industry: ${aiResponse.assessment.companyIndustry}`;
        }
        if (aiResponse.assessment.companyMainProduct) {
          plainTextMessage += `Main Product: ${aiResponse.assessment.companyMainProduct}`;
        }
        if (aiResponse.assessment.companyRevenue) {
          plainTextMessage += `Revenue: ${aiResponse.assessment.companyRevenue}`;
        }
        if (aiResponse.assessment.companyFounded) {
          plainTextMessage += `Founded: ${aiResponse.assessment.companyFounded}`;
        }
        if (aiResponse.assessment.companyLocation) {
          plainTextMessage += `Location: ${aiResponse.assessment.companyLocation}`;
        }
        if (aiResponse.assessment.companyCEO) {
          plainTextMessage += `CEO: ${aiResponse.assessment.companyCEO}`;
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
                    text: `Assessment for ${aiResponse.assessment.companyName}`,
                    size: "Large",
                    weight: "Bolder",
                    wrap: true,
                  },
                  {
                    type: "FactSet",
                    facts: [
                      {
                        title: "Description",
                        value: aiResponse.assessment.companyDescription,
                      },
                      {
                        title: "Size",
                        value: aiResponse.assessment.companySize.toString(),
                      },
                      {
                        title: "Industry",
                        value: aiResponse.assessment.companyIndustry,
                      },
                      {
                        title: "Main Product",
                        value: aiResponse.assessment.companyMainProduct,
                      },
                      {
                        title: "Revenue",
                        value: `$${aiResponse.assessment.companyRevenue.toLocaleString()}`,
                      },
                      {
                        title: "Founded",
                        value: aiResponse.assessment.companyFounded.toString(),
                      },
                      {
                        title: "Location",
                        value: aiResponse.assessment.companyLocation,
                      },
                      {
                        title: "CEO",
                        value: aiResponse.assessment.companyCEO,
                      },
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
      } else if (aiResponse.clarificationQuestion) {
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
      }
    } else {
      throw new Error("Unsupported message type");
    }
  }

  private async generateResponse(
    messages: { role: string; content: string }[]
  ): Promise<LeadQualificationResponse> {
    const systemPrompt = `You are pretending to be a lead qualification agent for a B2B SaaS company.
Your job is to qualify leads given the name of a company and the name of the person who contacted you.
You MUST make up realistic company details whenever you have a company name - do not ask for more information about the company itself.
Only ask clarifying questions about the prospect's specific needs, budget, or timeline - not about the company details.

For example, when given a company name, generate details like this:
Company name: Acme Inc.
Company Description: Acme Inc. is a software company that provides a platform for managing customer relationships.
Size: 1000 employees
Industry: Software
Main Product: CRM
Revenue: $100M ARR
CEO: John Doe
Founded: 2010
Location: San Francisco, CA

<RULES>
1. ALWAYS make up realistic company details when you have a company name - never ask for company information.
2. Only ask clarification questions about the prospect's contact.
3. Generate a complete assessment with made-up but realistic details for any company name you receive.
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
        schema: leadQualificationResponseSchema,
      });

      return result.object;
    } catch (error) {
      logger.error("Error generating response", error);
      throw error;
    }
  }
}
