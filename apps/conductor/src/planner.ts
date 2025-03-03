import { Agent } from "@repo/task-management-interfaces";

interface TaskPlan {
  title: string;
  description: string;
  executor: Agent;
  subTasks: TaskPlan[];
}

export class Planner {
  private agents: Agent[];

  constructor(agents: Agent[]) {
    this.agents = agents;
  }

  public plan(taskTitle: string): TaskPlan {
    let subTasks: TaskPlan[] = [];

    // For now, we'll have some hardcoded task breakdowns based on the task title
    switch (taskTitle.toLowerCase()) {
      case "build a web application":
        subTasks = this.createWebAppTasks();
        break;
      case "write a blog post":
        subTasks = this.createBlogPostTasks();
        break;
      case "deploy an application":
        subTasks = this.createDeploymentTasks();
        break;
    }

    return {
      title: taskTitle,
      description: `Plan for: ${taskTitle}`,
      executor: this.agents[0],
      subTasks,
    };
  }

  private createSingleTask(title: string): TaskPlan {
    return {
      title,
      description: `Execute task: ${title}`,
      executor: this.agents[0],
      subTasks: [],
    };
  }

  private createWebAppTasks(): TaskPlan[] {
    return [
      this.createSingleTask("Design UI/UX mockups"),
      this.createSingleTask("Set up project structure"),
      this.createSingleTask("Implement frontend components"),
      this.createSingleTask("Create backend API"),
      this.createSingleTask("Write tests"),
    ];
  }

  private createBlogPostTasks(): TaskPlan[] {
    return [
      this.createSingleTask("Research topic"),
      this.createSingleTask("Create outline"),
      this.createSingleTask("Write first draft"),
      this.createSingleTask("Edit and proofread"),
      this.createSingleTask("Add images and formatting"),
    ];
  }

  private createDeploymentTasks(): TaskPlan[] {
    return [
      this.createSingleTask("Set up deployment environment"),
      this.createSingleTask("Configure CI/CD pipeline"),
      this.createSingleTask("Deploy to staging"),
      this.createSingleTask("Run integration tests"),
      this.createSingleTask("Deploy to production"),
    ];
  }
}
