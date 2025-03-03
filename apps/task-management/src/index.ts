import { Agent } from "@repo/task-management-interfaces";
import express from "express";
import path from "path";
import { SQLiteTaskStorage } from "./storage/SQLiteTaskStorage";
import { TaskService } from "./TaskService";

const app = express();
app.use(express.json());

const storage = new SQLiteTaskStorage(path.join(__dirname, "tasks.db"));
const taskService = new TaskService(storage);

// Initialize the service
taskService.initialize().catch(console.error);

// Error handler middleware
const errorHandler = (
  err: Error,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  console.error(err);
  res.status(500).json({ error: err.message });
};

// Create a new task
app.post("/tasks", async (req, res, next) => {
  try {
    const { title, description, createdBy, assignedTo, parentTaskId } =
      req.body;
    const task = await taskService.createTask(
      title,
      description,
      createdBy,
      assignedTo,
      parentTaskId
    );
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// Get a task by ID
app.get("/tasks/:id", async (req, res, next) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// List tasks with optional filters
app.get("/tasks", async (req, res, next) => {
  try {
    const { status, assignedTo, parentTaskId } = req.query;
    const filters: any = {};

    if (status) filters.status = status;
    if (assignedTo) filters.assignedTo = assignedTo;
    if (parentTaskId) filters.parentTaskId = parentTaskId;

    const tasks = await taskService.listTasks(filters);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

// Update task status
app.patch("/tasks/:id/status", async (req, res, next) => {
  try {
    const { status } = req.body;
    const task = await taskService.updateTaskStatus(req.params.id, status);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// Assign task to agent
app.patch("/tasks/:id/assign", async (req, res, next) => {
  try {
    const agent: Agent = req.body;
    const task = await taskService.assignTask(req.params.id, agent);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// Add execution log
app.post("/tasks/:id/logs", async (req, res, next) => {
  try {
    const { log } = req.body;
    const task = await taskService.addExecutionLog(req.params.id, log);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// Delete a task
app.delete("/tasks/:id", async (req, res, next) => {
  try {
    const success = await taskService.deleteTask(req.params.id);
    if (!success) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Task management server running on port ${PORT}`);
});
