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
import { conductor } from "./conductorCapability";
import { conductorState } from "./conductorState";
import { KNOWN_AGENTS } from "./constants";
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
  private planner: Planner;
  private taskManagementClient: TaskManagementClient;
  private workflowExecutor: WorkflowExecutor;
  constructor(runtime: Runtime) {
    super(runtime, [conductor]);
    this.planner = new Planner(KNOWN_AGENTS);
    this.taskManagementClient = new TaskManagementClient(
      "http://localhost:3002"
    );
    this.workflowExecutor = new WorkflowExecutor(
      this.taskManagementClient,
      this.runtime,
      conductorState
    );
  }

  async onMessage(message: AgentMessage, initiator: MessageInitiator) {
    switch (message.type) {
      case "do":
        const existingTasks = await this.getTasksForConversation(
          message.params.conversationId
        );
        if (existingTasks.length > 0) {
          const tasks = await this.taskManagementClient.listTasks({
            ids: existingTasks.map((task) => task.taskId),
            status: "WaitingForUserResponse",
          });
          if (tasks.length === 1) {
            await this.addUserMessage(message.params.message, tasks[0]);
          } else if (tasks.length === 0) {
            logger.error("No blocked tasks found for a do-message", {
              conversationId: message.params.conversationId,
            });
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

  async doConduct(
    message: Extract<AgentMessage, { type: "do" }>,
    _initiator: MessageInitiator
  ) {
    const { parentTask, subTasks } = await this.buildAndSavePlan(
      message.params.message
    );
    await conductorState.createInitialState(
      parentTask.id,
      message.params.conversationId,
      [
        {
          role: "user",
          content: message.params.message,
        },
      ]
    );

    for (const subTask of subTasks) {
      await conductorState.createInitialState(
        subTask.id,
        message.params.conversationId,
        []
      );
    }
    await this.workflowExecutor.continueWorkflow(parentTask.id);
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
        await conductorState.addMessage(message.taskId, {
          role: "assistant",
          content: message.result.message ?? "Done!",
        });
        if (updatedTask.parentId) {
          await conductorState.addMessage(updatedTask.parentId, {
            role: "assistant",
            content: message.result.message ?? "Done!",
          });
        }
        await this.workflowExecutor.continueWorkflow(updatedTask.id);
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
    const state = await conductorState.getConversationStates(taskId);
    if (!state) {
      return { questionForUser: message };
    }
    // llm.answerClarification(messages);

    return {
      questionForUser: `Question: ${message}`,
    };
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
  }

  async buildAndSavePlan(task: string): Promise<{
    parentTask: Task;
    subTasks: Task[];
  }> {
    // Use planner to break down the task
    const taskPlan = this.planner.plan(task);
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
        assignedTo: task.executor.id,
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
}
