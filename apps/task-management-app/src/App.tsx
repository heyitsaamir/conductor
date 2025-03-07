import * as microsoftTeams from "@microsoft/teams-js";
import { Task, TaskStatus } from "@repo/task-management-interfaces";
import axios from "axios";
import { useEffect, useState } from "react";

const STATUS_COLORS: Record<TaskStatus, string> = {
  Todo: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  InProgress: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  Done: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  WaitingForUserResponse:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  Error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
} as const;

type TaskWithChildren = Task & { children?: TaskWithChildren[] };

function organizeTaskHierarchy(tasks: Task[]): TaskWithChildren[] {
  const taskMap = new Map<string, TaskWithChildren>();
  const rootTasks: TaskWithChildren[] = [];

  // First, convert all tasks to TaskWithChildren and sort by createdAt
  const sortedTasks = [...tasks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  sortedTasks.forEach((task) => {
    taskMap.set(task.id, { ...task, children: [] });
  });

  // Then, organize them into a hierarchy
  sortedTasks.forEach((task) => {
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

  // Sort children of each task
  const sortChildren = (tasks: TaskWithChildren[]) => {
    tasks.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    tasks.forEach((task) => {
      if (task.children && task.children.length > 0) {
        sortChildren(task.children);
      }
    });
  };

  sortChildren(rootTasks);

  return rootTasks;
}

function TaskCard({
  task,
  depth = 0,
}: {
  task: TaskWithChildren;
  depth?: number;
}) {
  const [isExpanded, setIsExpanded] = useState(task.status !== "Done");
  const hasChildren = task.children && task.children.length > 0;

  const handleClick = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="space-y-3">
      <div
        className={`bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm ${
          task.status === "Done" ? "opacity-60" : ""
        } cursor-pointer`}
        style={{ marginLeft: `${depth * 1.5}rem` }}
        onClick={handleClick}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {hasChildren && (
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""} text-gray-600 dark:text-gray-400`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            )}
            <h3 className="font-medium text-gray-900 dark:text-white">
              {task.title}
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {task.assignedTo && !isExpanded && (
              <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
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
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[task.status]}`}
            >
              {task.status}
            </span>
          </div>
        </div>

        {isExpanded && (
          <>
            <p className="text-gray-600 dark:text-gray-400 text-sm my-2">
              {task.description}
            </p>
            <div className="flex flex-wrap gap-2 items-center text-sm text-gray-500 dark:text-gray-400">
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
          </>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div className="space-y-3">
          {task.children?.map((child) => (
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

        // Set initial theme
        console.log("Teams theme:", context.app.theme);
        const isDarkTheme = context.app.theme === "dark";
        document.documentElement.className = isDarkTheme ? "dark" : "";

        // Register handlers for theme changes
        microsoftTeams.app.registerOnThemeChangeHandler((theme: string) => {
          console.log("Theme changed to:", theme);
          const isDarkTheme = theme === "dark";
          document.documentElement.className = isDarkTheme ? "dark" : "";
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

  // Separate active and completed tasks
  const { activeTasks, completedTasks } = organizedTasks.reduce<{
    activeTasks: TaskWithChildren[];
    completedTasks: TaskWithChildren[];
  }>(
    (acc, task) => {
      if (task.status === "Done") {
        acc.completedTasks.push(task);
      } else {
        acc.activeTasks.push(task);
      }
      return acc;
    },
    { activeTasks: [], completedTasks: [] }
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        {teamsContext?.user && (
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Welcome!
          </div>
        )}
        <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">
          Tasks
        </h1>
        <div className="space-y-4">
          {activeTasks.length === 0 && completedTasks.length === 0 ? (
            <div className="text-gray-500 dark:text-gray-400 text-center py-8">
              No tasks found
            </div>
          ) : (
            <>
              {/* Active Tasks */}
              <div className="space-y-4">
                {activeTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <>
                  <div className="border-t border-gray-200 dark:border-gray-700 my-8" />
                  <div className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-4">
                    Completed Tasks
                  </div>
                  <div className="space-y-4">
                    {completedTasks.map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
