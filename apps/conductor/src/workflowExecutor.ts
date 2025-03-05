import { DidRequest, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import { Task, TaskManagementClient } from "@repo/task-management-interfaces";
import { ConductorStateManager } from "./conductorState";

export class WorkflowExecutor {
  constructor(
    private taskManagementClient: TaskManagementClient,
    private runtime: Runtime,
    private conductorState: ConductorStateManager
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
      await this.conductorState.updateStatus(task.id, "completed");
      return "completed";
    }

    const nextTask = this.getNextTask(subTasks);
    if (!nextTask) {
      logger.info("No next task, marking task as completed", {
        taskId: task.id,
      });
      await this.taskManagementClient.updateTaskStatus(task.id, "Done");
      await this.conductorState.updateStatus(task.id, "completed");
      // TODO: inform user that the task was done
      return "completed";
    }

    await this.continueSubtask(nextTask);
    return "in-progress";
  }

  async continueSubtask(task: Task) {
    await this.prepareSubtaskForExecution(task);
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
        break;
      case "error":
        await this.taskManagementClient.updateTaskStatus(taskId, "Blocked");
        if (parentTask) {
          await this.conductorState.addMessage(parentTask.id, {
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
        break;
    }
  }

  private async prepareSubtaskForExecution(task: Task) {
    const taskState = await this.conductorState.getState(task.id);
    if (!taskState) return;

    const isFirstMessage = taskState.messages.length === 0;
    if (isFirstMessage) {
      const firstMessage: string = task.description; // TODO: Ask the llm to build the first message based on previous messages
      const parentState = await this.conductorState.getParentState(task.id);
      if (parentState) {
        await this.conductorState.addMessage(parentState.taskId, {
          role: "user",
          content: firstMessage,
        });
        await this.conductorState.setState(parentState.taskId, {
          ...parentState,
          currentTaskId: task.id,
        });
      }
      await this.conductorState.addMessage(task.id, {
        role: "user",
        content: firstMessage,
      });
    }
    await this.taskManagementClient.updateTaskStatus(task.id, "InProgress");
    await this.conductorState.updateStatus(task.id, "in-progress");
  }

  private async executeTask(task: Task) {
    if (!task.assignedTo) {
      throw new Error("Task assignedTo is undefined");
    }
    logger.info("Executing task", { task });
    const taskState = await this.conductorState.getState(task.id);
    if (!taskState) {
      throw new Error("Task state not found");
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
