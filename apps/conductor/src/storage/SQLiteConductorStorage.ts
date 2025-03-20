import { Database } from "sqlite3";
import { ConversationMessage, ConversationStateData } from "../conductorState";

interface ConversationStateRow {
  stateId: string;
  conversationId: string;
  messages: string;
  taskId: string;
  createdAt: number;
  planActivityId?: string;
}

export class SQLiteConductorStorage {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(
          `CREATE TABLE IF NOT EXISTS conversation_states (
            stateId TEXT PRIMARY KEY,
            conversationId TEXT NOT NULL,
            messages TEXT NOT NULL,
            taskId TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            planActivityId TEXT
          )`,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );

        // Create index for faster lookups by conversationId
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_conversation_id 
           ON conversation_states(conversationId)`,
          (err) => {
            if (err) console.error("Failed to create index:", err);
          }
        );

        // Create index for faster lookups by taskId
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_task_id 
           ON conversation_states(taskId)`,
          (err) => {
            if (err) console.error("Failed to create index:", err);
          }
        );
      });
    });
  }

  async setConversationState(
    stateId: string,
    state: ConversationStateData
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO conversation_states (
          stateId, conversationId, messages, taskId, createdAt, planActivityId
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          stateId,
          state.conversationId,
          JSON.stringify(state.messages),
          state.taskId,
          state.createdAt,
          state.planActivityId || null,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async updateMessages(
    stateId: string,
    messages: ConversationMessage[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE conversation_states 
         SET messages = ? 
         WHERE stateId = ?`,
        [JSON.stringify(messages), stateId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getConversationState(
    stateId: string
  ): Promise<ConversationStateData | null> {
    return new Promise((resolve, reject) => {
      this.db.get<ConversationStateRow>(
        "SELECT * FROM conversation_states WHERE stateId = ?",
        [stateId],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            resolve({
              stateId: row.stateId,
              conversationId: row.conversationId,
              messages: JSON.parse(row.messages),
              taskId: row.taskId,
              createdAt: row.createdAt,
              planActivityId: row.planActivityId,
            });
          }
        }
      );
    });
  }

  async findStateByTaskId(
    taskId: string
  ): Promise<ConversationStateData | null> {
    return new Promise((resolve, reject) => {
      // Get the most recent state for this task ID
      this.db.get<ConversationStateRow>(
        "SELECT * FROM conversation_states WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1",
        [taskId],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            resolve({
              stateId: row.stateId,
              conversationId: row.conversationId,
              messages: JSON.parse(row.messages),
              taskId: row.taskId,
              createdAt: row.createdAt,
              planActivityId: row.planActivityId,
            });
          }
        }
      );
    });
  }

  async findStatesByConversationId(
    conversationId: string
  ): Promise<ConversationStateData[]> {
    return new Promise((resolve, reject) => {
      this.db.all<ConversationStateRow>(
        "SELECT * FROM conversation_states WHERE conversationId = ?",
        [conversationId],
        (err, rows) => {
          if (err) reject(err);
          else if (!rows || rows.length === 0) resolve([]);
          else {
            const states = rows.map((row) => ({
              stateId: row.stateId,
              conversationId: row.conversationId,
              messages: JSON.parse(row.messages),
              taskId: row.taskId,
              createdAt: row.createdAt,
              planActivityId: row.planActivityId,
            }));
            resolve(states);
          }
        }
      );
    });
  }

  async getAllConversationStates(): Promise<
    Record<string, ConversationStateData>
  > {
    return new Promise((resolve, reject) => {
      this.db.all<ConversationStateRow>(
        "SELECT * FROM conversation_states",
        [],
        (err, rows) => {
          if (err) reject(err);
          else {
            const states: Record<string, ConversationStateData> = {};
            rows.forEach((row) => {
              states[row.stateId] = {
                stateId: row.stateId,
                conversationId: row.conversationId,
                messages: JSON.parse(row.messages),
                taskId: row.taskId,
                createdAt: row.createdAt,
                planActivityId: row.planActivityId,
              };
            });
            resolve(states);
          }
        }
      );
    });
  }

  async deleteConversationState(stateId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        "DELETE FROM conversation_states WHERE stateId = ?",
        [stateId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async deleteStatesByConversationId(conversationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        "DELETE FROM conversation_states WHERE conversationId = ?",
        [conversationId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async deleteStatesByTaskId(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        "DELETE FROM conversation_states WHERE taskId = ?",
        [taskId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async setPlanActivityId(
    taskId: string,
    planActivityId: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Get the most recent state for this task ID
      this.db.get<ConversationStateRow>(
        "SELECT stateId FROM conversation_states WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1",
        [taskId],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (!row) {
            reject(new Error(`No state found for task ID: ${taskId}`));
          } else {
            // Update the planActivityId for this state
            this.db.run(
              "UPDATE conversation_states SET planActivityId = ? WHERE stateId = ?",
              [planActivityId, row.stateId],
              (updateErr) => {
                if (updateErr) reject(updateErr);
                else resolve();
              }
            );
          }
        }
      );
    });
  }

  async getPlanActivityId(taskId: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      // Get the most recent state for this task ID
      this.db.get<ConversationStateRow>(
        "SELECT planActivityId FROM conversation_states WHERE taskId = ? ORDER BY createdAt DESC LIMIT 1",
        [taskId],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else resolve(row.planActivityId || null);
        }
      );
    });
  }
}
