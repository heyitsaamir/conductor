import { createAzure } from "@ai-sdk/azure";
import { toActivityParams } from "@microsoft/spark.api";
import { App } from "@microsoft/spark.apps";
import {
  BaseAgent,
  ExactMessage,
  MessageInitiator,
  Runtime,
} from "@repo/agent-contract";
import { logger } from "@repo/common";
import {
  Agent,
  Task,
  TaskManagementClient,
} from "@repo/task-management-interfaces";
import { CoreMessage, generateText } from "ai";
import { defaultAgentStore } from "./agentStore";
import { conductor } from "./conductorCapability";
import {
  conductorState,
  ConversationMessage,
  ConversationStateData,
} from "./conductorState";
import { PlanCard } from "./planCard";
import { Planner } from "./planner";
import { WorkflowExecutor } from "./workflowExecutor";
type SupportedCapability = typeof conductor;

type AgentMessage = ExactMessage<SupportedCapability>;

const SELF_AGENT: Agent = {
  id: "conductor",
  name: "Conductor",
  url: "http://localhost:3000",
};

export class ConductorAgent extends BaseAgent<SupportedCapability> {
  readonly id = "conductor";
  private planner: Planner;
  private taskManagementClient: TaskManagementClient;
  private workflowExecutor: WorkflowExecutor;
  private teamsApp: App;

  constructor(runtime: Runtime, teamsApp: App) {
    super(runtime, [conductor]);
    this.planner = new Planner(defaultAgentStore);
    this.taskManagementClient = new TaskManagementClient(
      "http://localhost:3002"
    );
    this.teamsApp = teamsApp;
    this.workflowExecutor = new WorkflowExecutor(
      this.taskManagementClient,
      this.runtime,
      conductorState,
      defaultAgentStore
    );
    this.subscribeToTaskUpdates();
  }

  private subscribeToTaskUpdates() {
    this.workflowExecutor.on("taskStatusChanged", async (task: Task) => {
      const taskState = await conductorState.getStateByTaskId(task.id);
      if (!taskState) return;

      const parentTask = task.parentId
        ? await this.taskManagementClient.getTask(task.parentId)
        : task;

      const planActivityId = await conductorState.getPlanActivityId(
        parentTask.id
      );
      if (!planActivityId) return;

      await this.updatePlanCard(
        parentTask.id,
        planActivityId,
        taskState.conversationId
      );
    });
  }

  async onMessage(message: AgentMessage, initiator: MessageInitiator) {
    switch (message.type) {
      case "do":
        const existingTasks = await this.getTasksForConversation(
          message.params.conversationId
        );
        if (existingTasks.length > 0) {
          logger.info("Existing tasks found for conversation", {
            conversationId: message.params.conversationId,
            tasks: existingTasks,
          });
          const tasks = await this.taskManagementClient.listTasks({
            ids: existingTasks.map((task) => task.taskId),
            status: "WaitingForUserResponse",
          });
          if (tasks.length === 1) {
            await this.addUserMessage(message.params.message, tasks[0]);
          } else if (tasks.length === 0) {
            if (await this.hasIncompleteTasks(message.params.conversationId)) {
              logger.error(
                "There were incomplete tasks for this converstaion but no tasks are waiting for response"
              );
            } else {
              logger.info(
                "No blocked tasks found for a do-message, creating a new task"
              );
              await this.doConduct(message, initiator);
            }
          } else {
            logger.error("Multiple blocked tasks found for a do-message", {
              conversationId: message.params.conversationId,
              tasks: tasks,
            });
            throw new Error("Multiple blocked tasks found for a do-message");
          }
        } else {
          await this.doConduct(message, initiator);
        }
        break;
      case "did":
        await this.didTask(message, initiator);
    }
  }

  private async hasIncompleteTasks(conversationId: string) {
    // Check if all the tasks for this conversation are done
    const latestParentTask = await this.latestParentTask(conversationId);
    if (!latestParentTask) {
      return false;
    }
    return latestParentTask?.status !== "Done";
  }

  async latestParentTask(conversationId: string) {
    const conversationStates =
      await this.getTasksForConversation(conversationId);

    logger.info("[latestParentTask] Conversation states", {
      conversationStates,
    });
    const taskIds = conversationStates.map((state) => state.taskId);
    if (taskIds.length === 0) {
      return null;
    }
    // logger.info("[latestParentTask] Task ids", { taskIds });
    const tasks = await this.taskManagementClient.listTasks({
      ids: taskIds,
    });
    // logger.info("[latestParentTask] Tasks", { tasks });
    const parentTasks = tasks.filter((task) => !task.parentId);
    if (parentTasks.length === 0) {
      return null;
    }
    // logger.info("[latestParentTask] Parent tasks", { parentTasks });
    const latestParentTask = parentTasks.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    )[0];
    // logger.info("[latestParentTask] Latest parent task", { latestParentTask });
    return latestParentTask;
  }

  async doConduct(
    message: Extract<AgentMessage, { type: "do" }>,
    _initiator: MessageInitiator
  ) {
    const latestParentTask = await this.latestParentTask(
      message.params.conversationId
    );
    let previousTask: ConversationStateData | undefined;
    if (latestParentTask) {
      const stateForLatestParentTask = await conductorState.getStateByTaskId(
        latestParentTask.id
      );
      previousTask = stateForLatestParentTask ?? undefined;
    }
    const { parentTask, subTasks } = await this.buildAndSavePlan(
      message.params.message,
      previousTask
    );

    let initialMessages: ConversationMessage[] = [];
    if (previousTask) {
      initialMessages.push(...previousTask.messages);
    }

    initialMessages.push({
      role: "user",
      content: message.params.message,
    });

    await conductorState.createInitialState(
      parentTask.id,
      message.params.conversationId,
      initialMessages
    );

    for (const subTask of subTasks) {
      await conductorState.createInitialState(
        subTask.id,
        message.params.conversationId,
        []
      );
    }

    const planMessage = PlanCard.createCard(parentTask, subTasks, true);
    const planPlainMessage = `
    Plan:
    ${parentTask.title}
    ${parentTask.description}
    ${subTasks.map((subtask, i) => ` ${i + 1}. ${subtask.description} (_@${subtask.assignedTo ?? "Unassigned"}_)\n`).join("")}

    Does this plan look good?
    `;

    // Update parent state
    await conductorState.addMessage(parentTask.id, {
      role: "user",
      content: planPlainMessage,
    });

    const result = await this.runtime.sendMessage(
      {
        type: "did",
        status: "success",
        taskId: parentTask.id,
        result: {
          message: JSON.stringify(planMessage),
        },
      },
      { type: "teams", conversationId: message.params.conversationId }
    );

    // Save the plan message ID if it exists
    if (result) {
      await conductorState.setPlanActivityId(parentTask.id, result);
    }

    await this.taskManagementClient.updateTaskStatus(
      parentTask.id,
      "WaitingForUserResponse"
    );
    await this.handleWorkflowCompletion(parentTask.id);
  }

  async getTasksForConversation(conversationId: string) {
    return await conductorState.getConversationStates(conversationId);
  }
  async didTask(
    message: Extract<AgentMessage, { type: "did" }>,
    initiator: MessageInitiator
  ) {
    const updatedTask = await this.workflowExecutor.handleSubtaskResult(
      message.taskId,
      message
    );
    switch (message.status) {
      case "success": {
        let messageToSend = message.result?.message ?? "Done!";
        let messageToSave = messageToSend;
        // Try to parse JSON message and extract plainTextMessage if it exists
        if (
          messageToSave.trim().startsWith("{") &&
          messageToSave.trim().endsWith("}")
        ) {
          try {
            const parsedMessage = JSON.parse(messageToSave);
            if (parsedMessage.plainTextMessage) {
              messageToSave = parsedMessage.plainTextMessage;
            }
          } catch (error) {
            logger.debug("Failed to parse message as JSON", {
              message: messageToSave,
            });
          }
        }

        await conductorState.addMessage(message.taskId, {
          role: "assistant",
          content: messageToSave,
        });
        if (updatedTask.parentId) {
          await conductorState.addMessage(updatedTask.parentId, {
            role: "assistant",
            content: messageToSave,
          });
        }
        const taskState = await conductorState.getStateByTaskId(message.taskId);
        if (!taskState) {
          logger.error("No task state found for task", {
            taskId: message.taskId,
          });
          break;
        }
        await this.runtime.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: messageToSend,
            },
          },
          {
            type: "teams",
            conversationId: taskState.conversationId,
            byAgentId: updatedTask.assignedTo,
          }
        );
        await this.workflowExecutor.continueWorkflow(updatedTask.id);
        await this.handleWorkflowCompletion(updatedTask.id);
        break;
      }
      case "error": {
        await conductorState.addMessage(message.taskId, {
          role: "assistant",
          content: message.error.message ?? "There was an error",
        });
        if (updatedTask.parentId) {
          await conductorState.addMessage(updatedTask.parentId, {
            role: "assistant",
            content: message.error.message ?? "There was an error",
          });
        }
        const taskState = await conductorState.getStateByTaskId(message.taskId);
        if (!taskState) {
          logger.error("No task state found for task", {
            taskId: message.taskId,
          });
          break;
        }
        await this.runtime.sendMessage(
          {
            type: "did",
            status: "success",
            taskId: message.taskId,
            result: {
              message: message.error.message ?? "There was an error",
            },
          },
          {
            type: "teams",
            conversationId: taskState.conversationId,
            byAgentId: updatedTask.assignedTo,
          }
        );
        break;
      }
      case "needs_clarification": {
        const state = await conductorState.getStateByTaskId(message.taskId);
        if (!state) {
          logger.error("No state found for task", {
            taskId: message.taskId,
          });
          break;
        }

        if (initiator.type === "teams") {
          logger.error("Teams initiator not supported for needs clarification");
          break;
        }

        logger.info("Needs clarification", {
          conversationId: state.conversationId,
          message: message.clarification.message,
        });
        // ask conductor to clarify if it can. if it can't, then we need to ask the user
        const result = await this.answerClarification(
          message.clarification.message,
          message.taskId
        );
        if ("answer" in result) {
          await conductorState.addMessage(message.taskId, {
            role: "user",
            content: result.answer,
          });
          await this.workflowExecutor.continueSubtask(updatedTask);
        } else {
          await conductorState.addMessage(message.taskId, {
            role: "assistant",
            content: result.questionForUser,
          });
          if (updatedTask.parentId) {
            await conductorState.addMessage(updatedTask.parentId, {
              role: "assistant",
              content: result.questionForUser,
            });
          }
          await this.runtime.sendMessage(
            {
              type: "did",
              status: "needs_clarification",
              taskId: message.taskId,
              clarification: {
                message: result.questionForUser,
              },
            },
            {
              type: "teams",
              conversationId: state.conversationId,
              byAgentId: initiator.id,
            }
          );
        }
        break;
      }
    }
  }

  async handleWorkflowCompletion(taskId: string) {
    const taskState = await conductorState.getStateByTaskId(taskId);
    if (!taskState) {
      logger.error("No task state found for task", {
        taskId: taskId,
      });
      return;
    }
    // Make sure this is the parent
    let task = await this.taskManagementClient.getTask(taskId);
    if (task.parentId) {
      task = await this.taskManagementClient.getTask(task.parentId);
    }
    if (task.status !== "Done") {
      logger.info("Task is not done", {
        taskId: taskId,
      });
      return;
    }

    logger.info("Handling completion for a subtask, getting the parent task");
    await this.runtime.sendMessage(
      {
        type: "did",
        status: "success",
        taskId: taskId,
        result: {
          message: "All tasks were completed successfully.",
        },
      },
      { type: "teams", conversationId: taskState.conversationId }
    );
  }

  async answerClarification(
    message: string,
    taskId: string
  ): Promise<
    | {
        answer: string;
      }
    | {
        questionForUser: string;
      }
  > {
    const task = await this.taskManagementClient.getTask(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    if (!task.parentId) {
      throw new Error("Task has no parent");
    }

    const stateForParentTask = await conductorState.getStateByTaskId(
      task.parentId
    );
    if (!stateForParentTask) {
      throw new Error("State for parent task not found");
    }

    // Get all messages from the conversation states
    const allMessages: CoreMessage[] = [];

    // Add system message to provide context
    allMessages.push({
      role: "system",
      content: `You are an AI assistant helping with a task. Answer the user's question based on the conversation history provided. Follow these rules:
<RULES>
1. You must only answer the question based on the conversation history provided.
2. If you can answer the question based on the conversation history, start your response with "ANSWER:"
3. If you cannot answer the question based on the conversation history, you must ask a follow-up question to the user. Start your response with "QUESTION FOR USER:". Provide all the relevant context in the question.
</RULES>
`,
    });

    // Add all messages from the conversation states
    let messagesStr = "";
    for (const msg of stateForParentTask.messages) {
      messagesStr += `${msg.role}: ${msg.content}\n`;
    }

    // Add the current question
    allMessages.push({
      role: "user",
      content: `<CONVERSATION HISTORY>
${messagesStr}
</CONVERSATION HISTORY>

<QUESTION>
${message}
</QUESTION>
`,
    });

    try {
      // Create OpenAI provider similar to how it's done in Planner
      const openai = createAzure({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: process.env.AZURE_OPENAI_ENDPOINT,
        apiVersion: "2024-10-21",
      });

      // Generate the response
      const { text } = await generateText({
        model: openai("gpt-4o"),
        messages: allMessages,
      });

      if (text.includes("ANSWER:")) {
        return { answer: text.replace("ANSWER:", "").trim() };
      } else if (text.includes("QUESTION FOR USER:")) {
        return {
          questionForUser: text.replace("QUESTION FOR USER:", "").trim(),
        };
      } else {
        logger.error("Unexpected response from AI", {
          text,
          taskId,
          message,
        });
        return {
          answer: `I couldn't process your question. Could you please rephrase or provide more details? Original question: ${message}`,
        };
      }
    } catch (error) {
      logger.error("Error answering clarification", { error, taskId, message });
      return {
        questionForUser: `I couldn't process your question. Could you please rephrase or provide more details? Original question: ${message}`,
      };
    }
  }

  async addUserMessage(message: string, blockedTask: Task) {
    // Add the message to the conversation state associated with the  blocked Task and also to the parent task if it exists
    await conductorState.addMessage(blockedTask.id, {
      role: "user",
      content: message,
    });
    if (blockedTask.parentId) {
      await conductorState.addMessage(blockedTask.parentId, {
        role: "user",
        content: message,
      });
    }
    await this.workflowExecutor.continueWorkflow(blockedTask.id);
    await this.handleWorkflowCompletion(blockedTask.id);
  }

  async buildAndSavePlan(
    task: string,
    previousTask?: ConversationStateData
  ): Promise<{
    parentTask: Task;
    subTasks: Task[];
  }> {
    // Use planner to break down the task
    const taskPlan = await this.planner.plan(task, previousTask);
    // Save the parent task
    const savedParentTask = await this.taskManagementClient.createTask({
      title: taskPlan.title,
      description: taskPlan.description,
      createdBy: SELF_AGENT.id,
      assignedTo: SELF_AGENT.id,
    });

    // Save all subtasks first
    const savedSubTasks = [];
    for (const task of taskPlan.subTasks) {
      const response = await this.taskManagementClient.createTask({
        title: task.title,
        description: task.description,
        createdBy: SELF_AGENT.id,
        parentId: savedParentTask.id,
        assignedTo: task.agentId,
      });
      savedSubTasks.push(response);
    }

    logger.info("Plan saved", {
      parentTask: savedParentTask,
      subTasks: savedSubTasks,
    });

    return {
      parentTask: savedParentTask,
      subTasks: savedSubTasks,
    };
  }

  private async updatePlanCard(
    planTaskId: string,
    planActivityId: string,
    conversationMessageId: string
  ) {
    const task = await this.taskManagementClient.getTask(planTaskId);
    if (!task) return;

    const subTasks = await this.taskManagementClient.getSubtasks(planTaskId);

    const planMessage = PlanCard.createCard(task, subTasks, false);

    await this.teamsApp.api.conversations
      .activities(conversationMessageId)
      .update(planActivityId, toActivityParams(planMessage));
  }
}
