import { createAzure } from "@ai-sdk/azure";
import { DidRequest, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import { Task, TaskManagementClient } from "@repo/task-management-interfaces";
import { CoreMessage, generateText } from "ai";
import { AgentStore } from "./agentStore";
import { ConductorStateManager } from "./conductorState";

export class WorkflowExecutor {
  private openai;

  constructor(
    private taskManagementClient: TaskManagementClient,
    private runtime: Runtime,
    private conductorState: ConductorStateManager,
    private agentStore: AgentStore
  ) {
    this.openai = createAzure({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: "2024-10-21",
    });
  }

  async continueWorkflow(
    taskIdArg: string | Task
  ): Promise<"in-progress" | "completed" | "failed"> {
    logger.debug("Continuing workflow", { taskIdArg });
    let task: Task;

    if (typeof taskIdArg === "string") {
      task = await this.taskManagementClient.getTask(taskIdArg);
    } else {
      task = taskIdArg;
    }

    if (!task) {
      throw new Error("Task not found");
    }

    if (task.parentId) {
      await this.continueSubtask(task);
      return "in-progress";
    }

    const subTasks = await this.taskManagementClient.getSubtasks(task.id);
    if (this.isTaskTerminal(task)) {
      logger.debug("Task is terminal, skipping", { task });
      return "completed";
    }

    const nextTask = this.getNextTask(subTasks);
    if (!nextTask) {
      logger.debug("No next task, marking task as completed", {
        taskId: task.id,
      });
      await this.taskManagementClient.updateTaskStatus(task.id, "Done");
      return "completed";
    }

    // Set the task as in progress
    if (task.status !== "InProgress") {
      await this.taskManagementClient.updateTaskStatus(task.id, "InProgress");
    }
    await this.continueSubtask(nextTask);
    return "in-progress";
  }

  async continueSubtask(task: Task) {
    if (this.isTaskTerminal(task)) {
      await this.taskManagementClient.updateTaskStatus(task.id, "Done");
      if (task.parentId) {
        await this.continueWorkflow(task.parentId);
      }
      return "completed";
    }
    await this.prepareSubtaskForExecution(task);
    await this.executeTask(task);
    return "in-progress";
  }

  async handleSubtaskResult(taskId: string, message: DidRequest) {
    switch (message.status) {
      case "success":
        return await this.taskManagementClient.updateTaskStatus(taskId, "Done");
        break;
      case "error":
        return await this.taskManagementClient.updateTaskStatus(
          taskId,
          "Error"
        );
        break;
      case "needs_clarification":
        return await this.taskManagementClient.updateTaskStatus(
          taskId,
          "WaitingForUserResponse"
        );
        break;
    }
  }

  private async buildFirstMessage(
    task: Task,
    parentState?: { messages: { role: string; content: string }[] } | null
  ): Promise<string> {
    if (!task.assignedTo) {
      throw new Error("Task assignedTo is undefined");
    }

    const agent = this.agentStore.getById(task.assignedTo);
    if (!agent) {
      throw new Error("Agent not found");
    }

    const previousContext = parentState?.messages.length
      ? `Previous context:\n${parentState.messages.map((msg) => `${msg.role}: ${msg.content}`).join("\n")}`
      : "No previous context.";

    const messages: CoreMessage[] = [
      {
        role: "system",
        content: `You are a task delegator. You are responsible for sending a brief, clear and directive message to an AI agent that will execute a task.
You will be given the agent's details, the task details, and some previous context from the user.

<RULES>
1. The message should be clear and directive, written as if you are delegating this task to the agent.
2. The context contained in the message must be relevant to the task at hand.
3. The message should be simple and concise. It should contain 1-2 sentences at most.
          `,
      },
      {
        role: "user",
        content: `
<AGENT DETAILS>
Agent Name: ${agent.name}
Agent Description: ${agent.description}
</AGENT DETAILS>

<TASK DETAILS>
Task Description: ${task.description}
</TASK DETAILS>

<PREVIOUS CONTEXT>
${previousContext}
</PREVIOUS CONTEXT>

Create a message for the given task to the given agent.`,
      },
    ];

    const { text } = await generateText({
      model: this.openai("gpt-4o"),
      messages,
    });

    if (!text) {
      throw new Error("Failed to generate message from LLM");
    }

    return text;
  }

  private async prepareSubtaskForExecution(task: Task) {
    const taskState = await this.conductorState.getStateByTaskId(task.id);
    if (!taskState) return;

    const isFirstMessage = taskState.messages.length === 0;
    if (isFirstMessage) {
      let parentState;
      if (task.parentId) {
        parentState = await this.conductorState.getStateByTaskId(task.parentId);
      }
      const firstMessage = await this.buildFirstMessage(task, parentState);

      if (parentState) {
        await this.conductorState.addMessage(parentState.taskId, {
          role: "user",
          content: firstMessage,
        });
      }
      await this.conductorState.addMessage(task.id, {
        role: "user",
        content: firstMessage,
      });
    }
    await this.taskManagementClient.updateTaskStatus(task.id, "InProgress");
  }

  private async executeTask(task: Task) {
    if (!task.assignedTo) {
      throw new Error("Task assignedTo is undefined");
    }
    logger.info("Executing task", { task });
    const taskState = await this.conductorState.getStateByTaskId(task.id);
    if (!taskState) {
      throw new Error("Task state not found");
    }
    if (taskState.messages.length === 1) {
      // Send it to Teams to show that we're telling an agent to do work
      const agent = this.agentStore.getById(task.assignedTo);
      if (!agent) {
        throw new Error("Agent not found");
      }
      await this.runtime.sendMessage(
        {
          type: "did",
          status: "success",
          taskId: task.id,
          result: {
            message: `**@${agent.name}** - ${taskState.messages[0].content}`,
          },
        },
        {
          type: "teams",
          conversationId: taskState.conversationId,
        }
      );
    }
    const lastMessage = taskState.messages.at(-1);
    if (!lastMessage) {
      throw new Error("No last message found");
    }
    const response = await this.runtime.sendMessage(
      {
        type: "do",
        taskId: task.id,
        method: "handleMessage",
        params: {
          taskId: task.id,
          message: lastMessage.content,
        },
      },
      {
        type: "delegate",
        id: task.assignedTo,
      }
    );
    return response;
  }

  private isTaskTerminal(task: Task): boolean {
    return task.status === "Done";
  }

  private getNextTask(subTasks: Task[]): Task | null {
    return subTasks.find((subTask) => !this.isTaskTerminal(subTask)) ?? null;
  }
}
