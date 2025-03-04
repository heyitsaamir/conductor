import { BaseAgent, ExactMessage, Runtime } from "@repo/agent-contract";
import { logger } from "@repo/common";
import {
  Agent,
  Task,
  TaskManagementClient,
} from "@repo/task-management-interfaces";
import { conductor } from "./conductorCapability";
import { Planner } from "./planner";
import { WorkflowExecutor } from "./workflowExecutor";
type SupportedCapability = typeof conductor;

type AgentMessage = ExactMessage<SupportedCapability>;

const KNOWN_AGENTS: Agent[] = [
  {
    id: "lead-qualification",
    name: "Lead Qualification",
    webhookAddress: "http://localhost:4000/recv",
  },
];

const SELF_AGENT: Agent = {
  id: "conductor",
  name: "Conductor",
  webhookAddress: "http://localhost:3000/recv",
};

export class ConductorAgent extends BaseAgent<SupportedCapability> {
  private planner: Planner;
  private taskManagementClient: TaskManagementClient;
  private workflowExecutor: WorkflowExecutor;
  constructor(runtime: Runtime) {
    super(runtime, [conductor]);
    this.planner = new Planner(KNOWN_AGENTS);
    this.taskManagementClient = new TaskManagementClient(
      "http://localhost:3002"
    );
    this.workflowExecutor = new WorkflowExecutor(
      this.taskManagementClient,
      this.runtime
    );
  }

  async onMessage(message: AgentMessage) {
    switch (message.type) {
      case "do":
        await this.doConduct(message);
        break;
      case "did":
        await this.didTask(message);
    }
  }

  async doConduct(message: Extract<AgentMessage, { type: "do" }>) {
    // This is a new task
    // We need to break it down into subtasks
    // Then we need to pass it along to the workflow executor
    const { parentTask } = await this.buildAndSavePlan(message.params.message);
    await this.workflowExecutor.continueWorkflow(parentTask.id);
  }

  async didTask(message: Extract<AgentMessage, { type: "did" }>) {
    await this.workflowExecutor.handleSubtaskResult(message.taskId, message);
  }

  async addUserMessage(message: string, taskId: string) {
    await this.workflowExecutor.handleUserMessage(taskId, message);
  }

  async buildAndSavePlan(task: string): Promise<{
    parentTask: Task;
    subTasks: Task[];
  }> {
    // Use planner to break down the task
    const taskPlan = this.planner.plan(task);
    // Save the parent task
    const savedParentTask = await this.taskManagementClient.createTask({
      title: taskPlan.title,
      description: taskPlan.description,
      createdBy: SELF_AGENT,
    });

    // Save all subtasks first
    const savedSubTasks = await Promise.all(
      taskPlan.subTasks.map(async (task) => {
        const response = await this.taskManagementClient.createTask({
          title: task.title,
          description: task.description,
          createdBy: SELF_AGENT,
          parentId: savedParentTask.id,
        });
        return response;
      })
    );

    logger.info("Plan saved", {
      parentTask: savedParentTask,
      subTasks: savedSubTasks,
    });

    return {
      parentTask: savedParentTask,
      subTasks: savedSubTasks,
    };
  }
}
