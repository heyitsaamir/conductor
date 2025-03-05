export type TaskStatus =
  | "Todo"
  | "InProgress"
  | "WaitingForUserResponse"
  | "Error"
  | "Done";

export interface Agent {
  id: string;
  name: string;
  url: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedTo?: string;
  createdBy: string;
  subTaskIds: string[];
  parentId?: string;
  createdAt: Date;
  updatedAt: Date;
  executionLogs?: string[];
}
