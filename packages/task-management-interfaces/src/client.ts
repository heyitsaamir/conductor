import { Task, TaskStatus } from "./interfaces";

export interface TaskFilters {
  status?: TaskStatus;
  assignedTo?: string;
  ids?: string[];
}

export type CreateTaskInput = Pick<
  Task,
  "title" | "description" | "createdBy"
> & {
  assignedTo?: string;
  parentId?: string;
};

export class TaskManagementClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async createTask(taskInput: CreateTaskInput): Promise<Task> {
    return this.request<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify(taskInput),
    });
  }

  async getTask(id: string): Promise<Task> {
    return this.request<Task>(`/tasks/${id}`);
  }

  async getSubtasks(taskId: string): Promise<Task[]> {
    return this.request<Task[]>(`/tasks/${taskId}/subtasks`);
  }

  async listTasks(filters: TaskFilters = {}): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.assignedTo) params.set("assignedTo", filters.assignedTo);
    if (filters.ids) params.set("ids", filters.ids.join(","));

    const query = params.toString();
    return this.request<Task[]>(`/tasks${query ? `?${query}` : ""}`);
  }

  async updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
    return this.request<Task>(`/tasks/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async assignTask(id: string, agent: string): Promise<Task> {
    return this.request<Task>(`/tasks/${id}/assign`, {
      method: "PATCH",
      body: JSON.stringify(agent),
    });
  }

  async addExecutionLog(id: string, log: string): Promise<Task> {
    return this.request<Task>(`/tasks/${id}/logs`, {
      method: "POST",
      body: JSON.stringify({ log }),
    });
  }

  async deleteTask(id: string): Promise<void> {
    await this.request<void>(`/tasks/${id}`, {
      method: "DELETE",
    });
  }
}
