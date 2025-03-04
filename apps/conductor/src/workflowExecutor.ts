import { DidRequest, Runtime } from "@repo/agent-contract";
import { Task, TaskManagementClient } from "@repo/task-management-interfaces";

export class WorkflowExecutor {
  constructor(
    private taskManagementClient: TaskManagementClient,
    private runtime: Runtime
  ) {}

  async continueWorkflow(taskIdArg: string | Task): Promise<void> {
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
      console.log(`Task ${task.id} is terminal, skipping`);
      return;
    }

    const nextTask = this.getNextTask(subTasks);
    if (!nextTask) {
      await this.taskManagementClient.updateTaskStatus(task.id, "Done");
      // TODO: inform user that the task was done
      return;
    }

    await this.prepareSubtaskForExecution(nextTask, task);
    await this.executeTask(nextTask);
  }

  async handleSubtaskResult(taskId: string, message: DidRequest) {
    const task = await this.taskManagementClient.getTask(taskId);
    const parentTask = task.parentId
      ? await this.taskManagementClient.getTask(task.parentId)
      : null;

    switch (message.status) {
      case "success":
        await this.taskManagementClient.updateTaskStatus(taskId, "Done");
        await this.taskManagementClient.addExecutionLog(
          taskId,
          message.result.message ?? "Done!"
        );
        if (parentTask) {
          await this.taskManagementClient.addExecutionLog(
            parentTask.id,
            `Subtask ${task.title} completed with result: ${message.result.message}`
          );
        }
        break;
      case "error":
        await this.taskManagementClient.updateTaskStatus(taskId, "Blocked");
        await this.taskManagementClient.addExecutionLog(
          taskId,
          message.error.message ?? "There was an error"
        );
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
    const isFirstMessage = task.executionLogs?.length === 0;
    if (isFirstMessage && parentTask) {
      if (parentTask) {
        await this.taskManagementClient.addExecutionLog(
          parentTask.id,
          `[${task.assignedTo?.name}] - ${task.description}`
        );
      }
      await this.taskManagementClient.addExecutionLog(
        task.id,
        task.description
      );
    }
    await this.taskManagementClient.updateTaskStatus(task.id, "InProgress");
  }

  private async executeTask(task: Task) {
    if (!task.assignedTo) {
      throw new Error("Task assignedTo is undefined");
    }

    const response = await this.runtime.sendMessage(
      {
        type: "do",
        taskId: task.id,
        method: "handleMessage",
        params: {
          taskId: task.id,
          messages: task.executionLogs ?? [],
        },
      },
      {
        type: "delegate",
        url: task.assignedTo.webhookAddress,
      }
    );
    return response;
  }

  async handleUserMessage(taskId: string, message: string) {
    const subTasks = await this.taskManagementClient.getSubtasks(taskId);
    const blockedSubtask = subTasks.find(
      (subtask) => subtask.status === "Blocked"
    );
    if (blockedSubtask) {
      // add to execution logs
      await this.taskManagementClient.addExecutionLog(
        blockedSubtask.id,
        message
      );
    }
  }

  private isTaskTerminal(task: Task): boolean {
    return task.status === "Done";
  }

  private getNextTask(subTasks: Task[]): Task | null {
    return subTasks.find((subTask) => !this.isTaskTerminal(subTask)) ?? null;
  }
}
