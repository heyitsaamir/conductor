import { DidRequest, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import {
  Agent,
  Task,
  TaskManagementClient,
} from "@repo/task-management-interfaces";
import { ConductorState } from "./conductorState";

export class WorkflowExecutor {
  constructor(
    private taskManagementClient: TaskManagementClient,
    private runtime: Runtime,
    private knownAgents: Agent[],
    private conductorState: ConductorState
  ) {}

  async continueWorkflow(
    taskIdArg: string | Task
  ): Promise<"in-progress" | "completed" | "failed"> {
    logger.info("Continuing workflow", { taskIdArg });
    let task: Task;

    if (typeof taskIdArg === "string") {
      task = await this.taskManagementClient.getTask(taskIdArg);
    } else {
      task = taskIdArg;
    }

    const subTasks = await this.taskManagementClient.getSubtasks(task.id);

    if (!task) {
      throw new Error("Task not found");
    }

    if (this.isTaskTerminal(task)) {
      logger.info("Task is terminal, skipping", { task });
      this.conductorState[task.id].currentStatus = "completed";
      return "completed";
    }

    const nextTask = this.getNextTask(subTasks);
    if (!nextTask) {
      logger.info("No next task, marking task as completed", {
        taskId: task.id,
      });
      await this.taskManagementClient.updateTaskStatus(task.id, "Done");
      this.conductorState[task.id].currentStatus = "completed";
      // TODO: inform user that the task was done
      return "completed";
    }

    await this.continueSubtask(nextTask);
    return "in-progress";
  }

  async continueSubtask(task: Task) {
    await this.prepareSubtaskForExecution(task, task);
    await this.executeTask(task);
  }

  async handleSubtaskResult(taskId: string, message: DidRequest) {
    const task = await this.taskManagementClient.getTask(taskId);
    const parentTask = task.parentId
      ? await this.taskManagementClient.getTask(task.parentId)
      : null;

    switch (message.status) {
      case "success":
        await this.taskManagementClient.updateTaskStatus(taskId, "Done");
        this.conductorState[taskId].currentStatus = "completed";
        // Update the task messages and the parent task messages
        this.conductorState[taskId].messages.push({
          role: "assistant",
          content: message.result.message ?? "Done!",
        });
        if (parentTask) {
          this.conductorState[parentTask.id].messages.push({
            role: "assistant",
            content: message.result.message ?? "Done!",
          });
        }
        break;
      case "error":
        await this.taskManagementClient.updateTaskStatus(taskId, "Blocked");
        this.conductorState[taskId].currentStatus = "failed";
        this.conductorState[taskId].messages.push({
          role: "assistant",
          content: message.error.message ?? "There was an error",
        });
        if (parentTask) {
          this.conductorState[parentTask.id].messages.push({
            role: "assistant",
            content: message.error.message ?? "There was an error",
          });
        }
        break;
      case "needs_clarification":
        await this.taskManagementClient.updateTaskStatus(taskId, "Blocked");
        await this.taskManagementClient.addExecutionLog(
          taskId,
          message.clarification.message ?? "Needs clarification"
        );
        console.log("// TODO: Send a message to the user to clarify something");
        break;
    }
  }

  private async prepareSubtaskForExecution(task: Task, parentTask: Task) {
    const taskState = this.conductorState[task.id];
    const isFirstMessage = taskState.messages.length === 0;
    const agent = this.knownAgents.find(
      (agent) => agent.id === task.assignedTo
    );
    if (!agent) {
      throw new Error(`Agent ${parentTask.assignedTo} not found`);
    }
    if (isFirstMessage) {
      const firstMessage: string = task.description; // TODO: Ask the llm to build the first message based on previous messages
      const parentState = taskState.parentTaskId
        ? this.conductorState[taskState.parentTaskId]
        : null;
      if (parentState) {
        parentState.messages.push({
          role: "user",
          content: firstMessage,
        });
        parentState.currentTaskId = task.id;
      }
      taskState.messages.push({
        role: "user",
        content: firstMessage,
      });
      await this.taskManagementClient.updateTaskStatus(task.id, "InProgress");
      this.conductorState[task.id].currentStatus = "in-progress";
    }
  }

  private async executeTask(task: Task) {
    if (!task.assignedTo) {
      throw new Error("Task assignedTo is undefined");
    }
    logger.info("Executing task", { task });
    const taskState = this.conductorState[task.id];
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

  async handleUserMessage(taskId: string, message: string) {
    const taskState = this.conductorState[taskId];
    const parentTask = taskState.parentTaskId
      ? this.conductorState[taskState.parentTaskId]
      : null;
    taskState.messages.push({
      role: "user",
      content: message,
    });
    if (parentTask) {
      parentTask.messages.push({
        role: "user",
        content: message,
      });
    }

    if (parentTask) {
      const task = await this.taskManagementClient.getTask(taskId);
      await this.continueSubtask(task);
    }
  }

  private isTaskTerminal(task: Task): boolean {
    return task.status === "Done";
  }

  private getNextTask(subTasks: Task[]): Task | null {
    return subTasks.find((subTask) => !this.isTaskTerminal(subTask)) ?? null;
  }
}
