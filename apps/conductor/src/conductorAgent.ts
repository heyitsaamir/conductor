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
  webhookAddress: "http://localhost:3000/recv",
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
        await this.doConduct(message, initiator);
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
    await conductorState.setState(parentTask.id, {
      messages: [
        {
          role: "user",
          content: message.params.message,
        },
      ],
      currentTaskId: parentTask.id,
      currentStatus: "todo",
      conversationId: message.params.conversationId,
      parentTaskId: null,
    });

    for (const subTask of subTasks) {
      await conductorState.setState(subTask.id, {
        messages: [],
        currentTaskId: subTask.id,
        currentStatus: "todo",
        conversationId: message.params.conversationId,
        parentTaskId: parentTask.id,
      });
    }
    await this.workflowExecutor.continueWorkflow(parentTask.id);
  }

  async didTask(
    message: Extract<AgentMessage, { type: "did" }>,
    initiator: MessageInitiator
  ) {
    await this.workflowExecutor.handleSubtaskResult(message.taskId, message);
    switch (message.status) {
      case "success": {
        await conductorState.updateStatus(message.taskId, "completed");
        await conductorState.addMessage(message.taskId, {
          role: "assistant",
          content: message.result.message ?? "Done!",
        });
        const state = await conductorState.getState(message.taskId);
        if (state?.parentTaskId) {
          await conductorState.addMessage(state.parentTaskId, {
            role: "assistant",
            content: message.result.message ?? "Done!",
          });
          await this.workflowExecutor.continueWorkflow(state.parentTaskId);
        }
        break;
      }
      case "error": {
        await conductorState.updateStatus(message.taskId, "failed");
        await conductorState.addMessage(message.taskId, {
          role: "assistant",
          content: message.error.message ?? "There was an error",
        });
        const state = await conductorState.getState(message.taskId);
        if (state?.parentTaskId) {
          await conductorState.addMessage(state.parentTaskId, {
            role: "assistant",
            content: message.error.message ?? "There was an error",
          });
        }
        break;
      }
      case "needs_clarification": {
        const state = await conductorState.getState(message.taskId);
        if (!state) break;

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
          await this.runtime.sendMessage(
            {
              type: "do",
              taskId: message.taskId,
              method: "handleMessage",
              params: {
                message: result.answer,
              },
            },
            this.getRecipient(initiator)
          );
        } else {
          await conductorState.updateStatus(message.taskId, "waiting_for_user");
          await conductorState.addMessage(message.taskId, {
            role: "assistant",
            content: result.questionForUser,
          });
          const parentState = await conductorState.getParentState(
            message.taskId
          );
          if (parentState) {
            await conductorState.updateStatus(
              parentState.taskId,
              "waiting_for_user"
            );
            await conductorState.addMessage(parentState.taskId, {
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
    const state = await conductorState.getState(taskId);
    if (!state) {
      return { questionForUser: message };
    }
    // llm.answerClarification(messages);

    return {
      questionForUser: `Question: ${message}`,
    };
  }

  async addUserMessage(message: string, taskId: string) {
    const taskState = await conductorState.getState(taskId);
    if (!taskState) {
      logger.error("Task state not found", { taskId });
      return;
    }

    if (taskState.parentTaskId) {
      logger.error("User messages should be handled by the parent task", {
        taskId,
      });
      return;
    }

    const currentTask = await conductorState.getState(taskState.currentTaskId);
    if (!currentTask) {
      logger.error("Current task not found", { taskId });
      return;
    }
    await conductorState.addMessage(taskId, {
      role: "user",
      content: message,
    });
    await conductorState.addMessage(currentTask.taskId, {
      role: "user",
      content: message,
    });

    await this.workflowExecutor.continueWorkflow(taskId);
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
