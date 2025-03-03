import { Agent, Task } from "./interfaces";
import { ITaskStorage } from "./storage/ITaskStorage";

export class TaskService {
  constructor(private storage: ITaskStorage) {}

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  async createTask(
    title: string,
    description: string,
    createdBy: Agent,
    assignedTo?: Agent,
    parentTaskId?: string
  ): Promise<Task> {
    const task = await this.storage.createTask({
      title,
      description,
      status: "Todo",
      createdBy,
      assignedTo,
      parentTaskId,
      executionLogs: [],
    });
    return task;
  }

  async getTask(id: string): Promise<Task | null> {
    return this.storage.getTask(id);
  }

  async updateTaskStatus(id: string, status: Task["status"]): Promise<Task> {
    return this.storage.updateTask(id, { status });
  }

  async assignTask(id: string, agent: Agent): Promise<Task> {
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
    parentTaskId?: string;
  }): Promise<Task[]> {
    return this.storage.listTasks(filters);
  }

  async deleteTask(id: string): Promise<boolean> {
    return this.storage.deleteTask(id);
  }
}
