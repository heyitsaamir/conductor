import path from "path";
import { SQLiteConductorStorage } from "./storage/SQLiteConductorStorage";

export interface ConductorStateData {
  taskId: string;
  messages: {
    role: "user" | "assistant" | "system";
    content: string;
  }[];
  currentTaskId: string;
  currentStatus:
    | "todo"
    | "in-progress"
    | "completed"
    | "failed"
    | "waiting_for_user";
  conversationId: string;
  parentTaskId: string | null;
}

export interface ConductorState {
  [taskId: string]: ConductorStateData;
}

export class ConductorStateManager {
  private storage: SQLiteConductorStorage;
  private static instance: ConductorStateManager;

  private constructor() {
    this.storage = new SQLiteConductorStorage(
      path.join(__dirname, "conductor.db")
    );
    this.storage.initialize().catch(console.error);
  }

  public static getInstance(): ConductorStateManager {
    if (!ConductorStateManager.instance) {
      ConductorStateManager.instance = new ConductorStateManager();
    }
    return ConductorStateManager.instance;
  }

  async getState(taskId: string): Promise<ConductorStateData | null> {
    return this.storage.getState(taskId);
  }

  async setState(
    taskId: string,
    state: Omit<ConductorStateData, "taskId">
  ): Promise<void> {
    const fullState: ConductorStateData = {
      taskId,
      ...state,
    };
    return this.storage.setState(taskId, fullState);
  }

  // Helper methods used by other files
  async findStateByConversationId(
    conversationId: string
  ): Promise<ConductorStateData | null> {
    return this.storage.findByConversationId(conversationId);
  }

  async updateStatus(
    taskId: string,
    status: ConductorStateData["currentStatus"]
  ): Promise<void> {
    const state = await this.getState(taskId);
    if (state) {
      await this.setState(taskId, {
        ...state,
        currentStatus: status,
      });
    }
  }

  async addMessage(
    taskId: string,
    message: { role: "user" | "assistant" | "system"; content: string }
  ): Promise<void> {
    const state = await this.getState(taskId);
    if (state) {
      await this.setState(taskId, {
        ...state,
        messages: [...state.messages, message],
      });
    }
  }

  async getParentState(taskId: string): Promise<ConductorStateData | null> {
    const state = await this.getState(taskId);
    if (state?.parentTaskId) {
      return this.getState(state.parentTaskId);
    }
    return null;
  }
}

// Export a singleton instance
export const conductorState = ConductorStateManager.getInstance();
