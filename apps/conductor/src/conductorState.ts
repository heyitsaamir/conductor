export interface ConductorState {
  [taskId: string]: {
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
  };
}

export const conductorState: ConductorState = {};
