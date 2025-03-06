import * as microsoftTeams from "@microsoft/teams-js";
import { Task, TaskStatus } from "@repo/task-management-interfaces";
import axios from "axios";
import { useEffect, useState } from "react";

const STATUS_COLORS: Record<TaskStatus, string> = {
  Todo: "bg-gray-100 text-gray-800",
  InProgress: "bg-blue-100 text-blue-800",
  Done: "bg-green-100 text-green-800",
  WaitingForUserResponse: "bg-yellow-100 text-yellow-800",
  Error: "bg-red-100 text-red-800",
} as const;

type TaskWithChildren = Task & { children?: TaskWithChildren[] };

function organizeTaskHierarchy(tasks: Task[]): TaskWithChildren[] {
  const taskMap = new Map<string, TaskWithChildren>();
  const rootTasks: TaskWithChildren[] = [];

  // First, convert all tasks to TaskWithChildren
  tasks.forEach((task) => {
    taskMap.set(task.id, { ...task, children: [] });
  });

  // Then, organize them into a hierarchy
  tasks.forEach((task) => {
    const taskWithChildren = taskMap.get(task.id)!;

    if (task.parentId) {
      const parent = taskMap.get(task.parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(taskWithChildren);
      } else {
        rootTasks.push(taskWithChildren);
      }
    } else {
      rootTasks.push(taskWithChildren);
    }
  });

  return rootTasks;
}

function TaskCard({
  task,
  depth = 0,
}: {
  task: TaskWithChildren;
  depth?: number;
}) {
  return (
    <div className="space-y-3">
      <div
        className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm"
        style={{ marginLeft: `${depth * 1.5}rem` }}
      >
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-medium">{task.title}</h3>
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status]}`}
          >
            {task.status}
          </span>
        </div>
        <p className="text-gray-600 text-sm mb-2">{task.description}</p>
        <div className="flex flex-wrap gap-2 items-center text-sm text-gray-500">
          {task.assignedTo && (
            <div className="flex items-center">
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              {task.assignedTo}
            </div>
          )}
          {task.subTaskIds.length > 0 && (
            <div className="flex items-center">
              <svg
                className="w-4 h-4 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              {task.subTaskIds.length} subtask
              {task.subTaskIds.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
      {task.children && task.children.length > 0 && (
        <div className="space-y-3">
          {task.children.map((child) => (
            <TaskCard key={child.id} task={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teamsContext, setTeamsContext] =
    useState<microsoftTeams.app.Context | null>(null);

  useEffect(() => {
    const initializeTeams = async () => {
      try {
        await microsoftTeams.app.initialize();
        const context = await microsoftTeams.app.getContext();
        setTeamsContext(context);

        // Register handlers for theme changes
        microsoftTeams.app.registerOnThemeChangeHandler((theme: string) => {
          document.body.className = theme;
        });
      } catch (err) {
        console.error("Failed to initialize Microsoft Teams:", err);
      }
    };

    initializeTeams();
  }, []);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const response = await axios.get("/tasks-api/tasks");
        setTasks(response.data);
      } catch (err: any) {
        console.error("Error fetching tasks:", {
          message: err.message,
          response: err.response?.data,
          status: err.response?.status,
        });
        setError(`Failed to fetch tasks: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (teamsContext) {
      fetchTasks();
    }
  }, [teamsContext]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Loading tasks...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-red-500">{error}</div>
      </div>
    );
  }

  const organizedTasks = organizeTaskHierarchy(tasks);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {teamsContext?.user && (
          <div className="text-sm text-gray-600 mb-4">
            Welcome, {teamsContext.user.displayName}
          </div>
        )}
        <h1 className="text-3xl font-bold mb-8">Tasks</h1>
        <div className="space-y-4">
          {organizedTasks.length === 0 ? (
            <div className="text-gray-500 text-center py-8">No tasks found</div>
          ) : (
            organizedTasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </div>
      </div>
    </div>
  );
}
