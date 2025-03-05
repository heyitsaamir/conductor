import { Database } from "sqlite3";
import { ConductorState, ConductorStateData } from "../conductorState";

interface ConductorStateRow {
  taskId: string;
  messages: string;
  currentTaskId: string;
  currentStatus: string;
  conversationId: string;
  parentTaskId: string | null;
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
          `CREATE TABLE IF NOT EXISTS conductor_state (
            taskId TEXT PRIMARY KEY,
            messages TEXT NOT NULL,
            currentTaskId TEXT NOT NULL,
            currentStatus TEXT NOT NULL,
            conversationId TEXT NOT NULL,
            parentTaskId TEXT
          )`,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  async setState(taskId: string, state: ConductorStateData): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO conductor_state (
          taskId, messages, currentTaskId, currentStatus, conversationId, parentTaskId
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          taskId,
          JSON.stringify(state.messages),
          state.currentTaskId,
          state.currentStatus,
          state.conversationId,
          state.parentTaskId,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getState(taskId: string): Promise<ConductorStateData | null> {
    return new Promise((resolve, reject) => {
      this.db.get<ConductorStateRow>(
        "SELECT * FROM conductor_state WHERE taskId = ?",
        [taskId],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            resolve({
              taskId: row.taskId,
              messages: JSON.parse(row.messages),
              currentTaskId: row.currentTaskId,
              currentStatus:
                row.currentStatus as ConductorStateData["currentStatus"],
              conversationId: row.conversationId,
              parentTaskId: row.parentTaskId,
            });
          }
        }
      );
    });
  }

  async getAllStates(): Promise<ConductorState> {
    return new Promise((resolve, reject) => {
      this.db.all<ConductorStateRow>(
        "SELECT * FROM conductor_state",
        [],
        (err, rows) => {
          if (err) reject(err);
          else {
            const state: ConductorState = {};
            rows.forEach((row) => {
              state[row.taskId] = {
                taskId: row.taskId,
                messages: JSON.parse(row.messages),
                currentTaskId: row.currentTaskId,
                currentStatus:
                  row.currentStatus as ConductorStateData["currentStatus"],
                conversationId: row.conversationId,
                parentTaskId: row.parentTaskId,
              };
            });
            resolve(state);
          }
        }
      );
    });
  }

  async deleteState(taskId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        "DELETE FROM conductor_state WHERE taskId = ?",
        [taskId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async findByConversationId(
    conversationId: string
  ): Promise<ConductorStateData | null> {
    return new Promise((resolve, reject) => {
      this.db.get<ConductorStateRow>(
        "SELECT * FROM conductor_state WHERE conversationId = ? AND parentTaskId IS NULL",
        [conversationId],
        (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            resolve({
              taskId: row.taskId,
              messages: JSON.parse(row.messages),
              currentTaskId: row.currentTaskId,
              currentStatus:
                row.currentStatus as ConductorStateData["currentStatus"],
              conversationId: row.conversationId,
              parentTaskId: row.parentTaskId,
            });
          }
        }
      );
    });
  }
}
