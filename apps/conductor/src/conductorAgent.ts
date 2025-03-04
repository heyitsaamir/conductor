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
      KNOWN_AGENTS,
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
    // This is a new task
    // We need to break it down into subtasks
    // Then we need to pass it along to the workflow executor
    const { parentTask, subTasks } = await this.buildAndSavePlan(
      message.params.message
    );
    conductorState[parentTask.id] = {
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
    };

    for (const subTask of subTasks) {
      conductorState[subTask.id] = {
        messages: [],
        currentTaskId: subTask.id,
        currentStatus: "todo",
        conversationId: message.params.conversationId,
        parentTaskId: parentTask.id,
      };
    }
    await this.workflowExecutor.continueWorkflow(parentTask.id);
  }

  async didTask(
    message: Extract<AgentMessage, { type: "did" }>,
    initiator: MessageInitiator
  ) {
    await this.workflowExecutor.handleSubtaskResult(message.taskId, message);
    switch (message.status) {
      case "success":
        {
          conductorState[message.taskId].currentStatus = "completed";
          conductorState[message.taskId].messages.push({
            role: "assistant",
            content: message.result.message ?? "Done!",
          });
          const parentStateId = conductorState[message.taskId].parentTaskId;
          if (parentStateId) {
            conductorState[parentStateId].messages.push({
              role: "assistant",
              content: message.result.message ?? "Done!",
            });
            await this.workflowExecutor.continueWorkflow(parentStateId);
          }
        }
        break;
      case "error":
        {
          conductorState[message.taskId].currentStatus = "failed";
          conductorState[message.taskId].messages.push({
            role: "assistant",
            content: message.error.message ?? "There was an error",
          });
          const parentStateId = conductorState[message.taskId].parentTaskId;
          if (parentStateId) {
            conductorState[parentStateId].messages.push({
              role: "assistant",
              content: message.error.message ?? "There was an error",
            });
          }
        }
        break;
      case "needs_clarification":
        logger.info("Needs clarification", {
          conversationId: conductorState[message.taskId].conversationId,
          message: message.clarification.message,
        });
        // ask conductor to clarify if it can. if it can't, then we need to ask the user
        const result = await this.answerClarification(
          message.clarification.message,
          message.taskId
        );
        if ("answer" in result) {
          conductorState[message.taskId].messages.push({
            role: "user",
            content: result.answer,
          }); // No need to add it to the parent state
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
          conductorState[message.taskId].currentStatus = "waiting_for_user";
          const parentStateId = conductorState[message.taskId].parentTaskId;
          conductorState[message.taskId].messages.push({
            role: "assistant",
            content: result.questionForUser,
          });
          if (parentStateId) {
            conductorState[parentStateId].currentStatus = "waiting_for_user";
            conductorState[parentStateId].messages.push({
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
              conversationId: conductorState[message.taskId].conversationId,
            }
          );
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
    const messages = conductorState[taskId].messages;
    messages.push({
      role: "user",
      content: message,
    });
    // llm.answerClarification(messages);

    return {
      questionForUser: message,
    };
  }

  async addUserMessage(message: string, taskId: string) {
    await this.workflowExecutor.handleUserMessage(taskId, message);
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
