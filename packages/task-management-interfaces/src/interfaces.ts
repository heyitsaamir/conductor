export type TaskStatus = "Todo" | "InProgress" | "Blocked" | "Done";

export interface Agent {
  id: string;
  name: string;
  webhookAddress: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedTo?: Agent;
  createdBy: Agent;
  subTaskIds: string[];
  createdAt: Date;
  updatedAt: Date;
  executionLogs?: string[];
}
