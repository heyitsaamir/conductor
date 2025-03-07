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
    .optional(),
  clarificationQuestion: z
    .string()
    .describe("A question to ask the user for more information")
    .optional(),
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
      } else if (aiResponse.assessment) {
        const markdownLines = [];
        markdownLines.push(
          `### Assessment for ${aiResponse.assessment.companyName}`
        );
        markdownLines.push(
          `- Company Description: ${aiResponse.assessment.companyDescription}`
        );
        markdownLines.push(
          `- Company Size: ${aiResponse.assessment.companySize}`
        );
        markdownLines.push(
          `- Company Industry: ${aiResponse.assessment.companyIndustry}`
        );
        markdownLines.push(
          `- Company Main Product: ${aiResponse.assessment.companyMainProduct}`
        );
        markdownLines.push(
          `- Company Revenue: ${aiResponse.assessment.companyRevenue}`
        );
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
  ): Promise<LeadQualificationResponse> {
    const systemPrompt = `You are pretending to be a lead qualification agent for a B2B SaaS company.
Your job is to qualify leads given the name of a company and the name of the person who contacted you.
If you have enough information to qualify the lead, provide a helpful response.
If you need more information, ask a clarification question.

If you have the company name, you can make up a company desscription and details about the company.
Eg. Company name: Acme Inc.
Company Description: Acme Inc. is a software company that provides a platform for managing customer relationships.
Size: 1000 employees
Industry: Software
Main Product: CRM
Revenue: $100M ARR
CEO: John Doe
Founded: 2010
Location: San Francisco, CA

<RULES>
1. If you have enough information to qualify the lead, provide a helpful response.
2. If you need more information, ask a clarification question.
3. If you have the company name, you can make up a company desscription and details about the company.
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
