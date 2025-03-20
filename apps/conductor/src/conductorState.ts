import path from "path";
import { SQLiteConductorStorage } from "./storage/SQLiteConductorStorage";

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ConversationStateData {
  stateId: string;
  conversationId: string;
  messages: ConversationMessage[];
  taskId: string;
  createdAt: number;
  planActivityId?: string;
}

export interface ConductorState {
  [stateId: string]: ConversationStateData;
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

  async getConversationState(
    stateId: string
  ): Promise<ConversationStateData | null> {
    return this.storage.getConversationState(stateId);
  }

  async getStateByTaskId(
    taskId: string
  ): Promise<ConversationStateData | null> {
    return this.storage.findStateByTaskId(taskId);
  }

  async setConversationState(
    taskId: string,
    conversationId: string,
    messages: ConversationMessage[],
    planActivityId?: string
  ): Promise<ConversationStateData> {
    const stateId = `${taskId}-${Date.now()}`;
    const state: ConversationStateData = {
      stateId,
      conversationId,
      taskId,
      messages,
      createdAt: Date.now(),
      planActivityId,
    };

    await this.storage.setConversationState(stateId, state);
    return state;
  }

  async addMessage(
    taskId: string,
    message: ConversationMessage
  ): Promise<ConversationStateData | null> {
    const state = await this.getStateByTaskId(taskId);
    if (!state) {
      return null;
    }

    // Update the existing state with the new message
    const updatedMessages = [...state.messages, message];
    await this.storage.updateMessages(state.stateId, updatedMessages);

    // Return the updated state
    return {
      ...state,
      messages: updatedMessages,
    };
  }

  async setPlanActivityId(
    taskId: string,
    planActivityId: string
  ): Promise<void> {
    return this.storage.setPlanActivityId(taskId, planActivityId);
  }

  async getPlanActivityId(taskId: string): Promise<string | null> {
    return this.storage.getPlanActivityId(taskId);
  }

  async getConversationStates(
    conversationId: string
  ): Promise<ConversationStateData[]> {
    return this.storage.findStatesByConversationId(conversationId);
  }

  async createInitialState(
    taskId: string,
    conversationId: string,
    initialMessages: ConversationMessage[] = [],
    planActivityId?: string
  ): Promise<ConversationStateData> {
    // Check if a state already exists for this task
    const existingState = await this.getStateByTaskId(taskId);
    if (existingState) {
      throw new Error(`State already exists for task ID: ${taskId}`);
    }

    const stateId = `${taskId}-${Date.now()}`;
    const state: ConversationStateData = {
      stateId,
      conversationId,
      taskId,
      messages: initialMessages,
      createdAt: Date.now(),
      planActivityId,
    };

    await this.storage.setConversationState(stateId, state);
    return state;
  }
}

// Export a singleton instance
export const conductorState = ConductorStateManager.getInstance();
