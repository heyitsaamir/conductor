import { AzureOpenAIProvider, createAzure } from "@ai-sdk/azure";
import { logger } from "@repo/common";
import { Agent } from "@repo/task-management-interfaces";
import { CoreMessage, generateObject } from "ai";
import { z } from "zod";
import { AgentStore } from "./agentStore";

const baseTaskPlanSchema = z.object({
  title: z.string(),
  description: z.string(),
});

const subTaskPlanSchema = z.intersection(
  baseTaskPlanSchema,
  z.object({
    agentId: z
      .string()
      .describe("The ID of the agent that should execute the subtask"),
  })
);

const taskPlanSchema = baseTaskPlanSchema.extend({
  subTasks: z.lazy(() => z.array(subTaskPlanSchema)),
});

type TaskPlan = z.infer<typeof taskPlanSchema>;

export class Planner {
  private openai: AzureOpenAIProvider;
  constructor(private agentStore: AgentStore) {
    console.log({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: process.env.AZURE_OPENAI_ENDPOINT,
    });
    this.openai = createAzure({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: "2024-10-21",
    });
  }

  public async plan(taskDescription: string): Promise<TaskPlan> {
    const availableAgents = this.agentStore.getAll();
    if (availableAgents.length === 0) {
      throw new Error("No agents available for task execution");
    }

    const agentDescriptions = availableAgents
      .map(
        (agent) =>
          `<AGENT id="${agent.id}" name="${agent.name}" description="${agent.description}" />`
      )
      .join("\n");

    const systemPrompt = `You are a task planner that breaks down tasks into sequential subtasks.
Given the task description and available agents, create a plan with appropriate subtasks.
Each subtask should be assigned to the most suitable agent.

Available agents:
${agentDescriptions}`;

    const messages: CoreMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: taskDescription },
    ];

    logger.debug("messages for generating plan", {
      messages,
    });

    const { object: generatedPlan } = await generateObject<TaskPlan>({
      model: this.openai("gpt-4o"),
      schema: taskPlanSchema,
      messages,
    });

    logger.info("Generated plan", {
      plan: generatedPlan,
    });

    return {
      title: generatedPlan.title,
      description: generatedPlan.description,
      subTasks: generatedPlan.subTasks.map((subtask) => {
        const subtaskExecutor = this.getAgentById(subtask.agentId);
        if (!subtaskExecutor) {
          throw new Error(`Agent ${subtask.agentId} not found`);
        }
        return {
          title: subtask.title,
          description: subtask.description,
          agentId: subtaskExecutor.id,
          subTasks: [],
        };
      }),
    };
  }

  private getAgentById(id: string): Agent | undefined {
    return this.agentStore.getAll().find((agent) => agent.id === id);
  }
}
