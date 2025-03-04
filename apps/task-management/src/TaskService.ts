import { Task } from "@repo/task-management-interfaces";
import { ITaskStorage } from "./storage/ITaskStorage";

export class TaskService {
  constructor(private storage: ITaskStorage) {}

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  async createTask(
    title: string,
    description: string,
    createdBy: string,
    assignedTo?: string,
    parentId?: string
  ): Promise<Task> {
    if (parentId) {
      const parentTask = await this.storage.getTask(parentId);
      if (!parentTask) {
        throw new Error("Parent task not found");
      }
    }

    const task = await this.storage.createTask({
      title,
      description,
      status: "Todo",
      createdBy: createdBy,
      assignedTo: assignedTo,
      subTaskIds: [],
      executionLogs: [],
      parentId,
    });

    if (parentId) {
      const parentTask = await this.storage.getTask(parentId);
      await this.storage.updateTask(parentId, {
        subTaskIds: [...parentTask!.subTaskIds, task.id],
      });
    }

    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.storage.getTask(id);
  }

  async updateTaskStatus(id: string, status: Task["status"]): Promise<Task> {
    return this.storage.updateTask(id, { status });
  }

  async assignTask(id: string, agent: string): Promise<Task> {
    return this.storage.updateTask(id, { assignedTo: agent });
  }

  async addExecutionLog(id: string, log: string): Promise<Task> {
    const task = await this.storage.getTask(id);
    if (!task) {
      throw new Error("Task not found");
    }

    const executionLogs = [...(task.executionLogs || []), log];
    return this.storage.updateTask(id, { executionLogs });
  }

  async listTasks(filters?: {
    status?: Task["status"];
    assignedTo?: string;
  }): Promise<Task[]> {
    return this.storage.listTasks(filters);
  }

  async deleteTask(id: string): Promise<boolean> {
    // First, remove this task from any parent's subTaskIds
    const allTasks = await this.listTasks();
    const parentTasks = allTasks.filter((task) => task.subTaskIds.includes(id));

    for (const parent of parentTasks) {
      await this.storage.updateTask(parent.id, {
        subTaskIds: parent.subTaskIds.filter((subtaskId) => subtaskId !== id),
      });
    }

    return this.storage.deleteTask(id);
  }

  async getSubtasks(taskId: string): Promise<Task[]> {
    const task = await this.storage.getTask(taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    if (task.subTaskIds.length === 0) {
      return [];
    }

    const subTasks = await this.storage.listTasks({ ids: task.subTaskIds });
    // order then in the same way as task.subTaskIds
    return subTasks.sort(
      (a, b) => task.subTaskIds.indexOf(a.id) - task.subTaskIds.indexOf(b.id)
    );
  }
}
