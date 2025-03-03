import { Task } from "../interfaces";

export interface ITaskStorage {
  createTask(task: Omit<Task, "id" | "createdAt" | "updatedAt">): Promise<Task>;
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, task: Partial<Task>): Promise<Task>;
  deleteTask(id: string): Promise<boolean>;
  listTasks(filters?: {
    status?: Task["status"];
    assignedTo?: string;
    parentTaskId?: string;
  }): Promise<Task[]>;
  initialize(): Promise<void>;
}
