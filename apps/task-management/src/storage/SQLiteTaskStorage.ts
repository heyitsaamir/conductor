import { Agent, Task } from "@repo/task-management-interfaces";
import { Database } from "sqlite3";
import { ITaskStorage } from "./ITaskStorage";

export class SQLiteTaskStorage implements ITaskStorage {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(
          `
                    CREATE TABLE IF NOT EXISTS tasks (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        description TEXT,
                        status TEXT NOT NULL,
                        assignedTo TEXT,
                        createdBy TEXT NOT NULL,
                        parentTaskId TEXT,
                        createdAt TEXT NOT NULL,
                        updatedAt TEXT NOT NULL,
                        executionLogs TEXT,
                        FOREIGN KEY (parentTaskId) REFERENCES tasks(id)
                    )
                `,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });
  }

  async createTask(
    task: Omit<Task, "id" | "createdAt" | "updatedAt">
  ): Promise<Task> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const newTask: Task = {
      ...task,
      id,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO tasks (
                    id, title, description, status, assignedTo, createdBy,
                    parentTaskId, createdAt, updatedAt, executionLogs
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newTask.id,
          newTask.title,
          newTask.description,
          newTask.status,
          newTask.assignedTo?.id,
          newTask.createdBy.id,
          newTask.parentTaskId,
          newTask.createdAt.toISOString(),
          newTask.updatedAt.toISOString(),
          JSON.stringify(newTask.executionLogs || []),
        ],
        (err) => {
          if (err) reject(err);
          else resolve(newTask);
        }
      );
    });
  }

  async getTask(id: string): Promise<Task | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT * FROM tasks WHERE id = ?",
        [id],
        async (err, row) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            resolve(this.mapRowToTask(row));
          }
        }
      );
    });
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const task = await this.getTask(id);
    if (!task) {
      throw new Error("Task not found");
    }

    const updatedTask = {
      ...task,
      ...updates,
      id,
      updatedAt: new Date(),
    };

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE tasks SET 
                    title = ?, description = ?, status = ?, assignedTo = ?,
                    parentTaskId = ?, updatedAt = ?, executionLogs = ?
                WHERE id = ?`,
        [
          updatedTask.title,
          updatedTask.description,
          updatedTask.status,
          updatedTask.assignedTo?.id,
          updatedTask.parentTaskId,
          updatedTask.updatedAt.toISOString(),
          JSON.stringify(updatedTask.executionLogs || []),
          id,
        ],
        (err) => {
          if (err) reject(err);
          else resolve(updatedTask);
        }
      );
    });
  }

  async deleteTask(id: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.db.run("DELETE FROM tasks WHERE id = ?", [id], function (err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  }

  async listTasks(filters?: {
    status?: Task["status"];
    assignedTo?: string;
    parentTaskId?: string;
  }): Promise<Task[]> {
    let query = "SELECT * FROM tasks WHERE 1=1";
    const params: any[] = [];

    if (filters?.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }
    if (filters?.assignedTo) {
      query += " AND assignedTo = ?";
      params.push(filters.assignedTo);
    }
    if (filters?.parentTaskId) {
      query += " AND parentTaskId = ?";
      params.push(filters.parentTaskId);
    }

    return new Promise((resolve, reject) => {
      this.db.all(query, params, async (err, rows) => {
        if (err) reject(err);
        else {
          const tasks = await Promise.all(
            rows.map((row) => this.mapRowToTask(row))
          );
          resolve(tasks);
        }
      });
    });
  }

  private async mapRowToTask(row: any): Promise<Task> {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      assignedTo: row.assignedTo
        ? await this.getAgent(row.assignedTo)
        : undefined,
      createdBy: await this.getAgent(row.createdBy),
      parentTaskId: row.parentTaskId,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      executionLogs: row.executionLogs
        ? JSON.parse(row.executionLogs)
        : undefined,
    };
  }

  private async getAgent(id: string): Promise<Agent> {
    // Note: In a real implementation, this would fetch from an agents table
    // For now, we'll return a mock agent
    return {
      id,
      name: "Agent",
      webhookAddress: "http://localhost:3000",
    };
  }
}
