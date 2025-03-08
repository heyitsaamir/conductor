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

const proposal = z.string();

// Define the schema for the AI response
const proposalResponseSchema = z.object({
  proposedProposal: proposal
    .optional()
    .nullable()
    .describe("The propsal for the sales reps"),

  clarificationQuestion: z
    .string()
    .optional()
    .nullable()
    .describe("A question to ask the user for more information"),
});

type ProposalResponse = z.infer<typeof proposalResponseSchema>;

export class AgentHandler extends BaseAgent<typeof HandleMessageCapability> {
  readonly id = "proposal-agent";
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

      if (aiResponse.proposedProposal) {
        messages.push({
          role: "assistant",
          content: aiResponse.proposedProposal,
        });

        await this.runtime.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: aiResponse.proposedProposal,
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
  ): Promise<ProposalResponse> {
    const systemPrompt = `You are a proposal agent for a B2B SaaS company. You build out sales proposals to help sales reps close deals to sell our company's product.
Our company details:
- Name: Acme Inc.
- Product: CMR (Customer Relationship Management)
- Description: Acme Inc. is a software-as-a-service company that provides a CMR to help businesses manage their customer relationships.

Given another company's details, you are able tobuild out a sales proposal to help the sales team out.

Things you need to know about to build out the proposal:
1. Description
2. Industry
3. Main product
4. Revenue

If you do not have any of that, you should ask for it.
`;

    // https://teamsaidev2.sharepoint.com/:i:/s/TeamsAI/EZCByWKuHXlBscBnAlnJpiYB2sUKr4yO6ZQf5b_oJkMAZA?e=bnuO42

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
        schema: proposalResponseSchema,
      });

      return result.object;
    } catch (error) {
      logger.error("Error generating response", error);
      throw error;
    }
  }
}
