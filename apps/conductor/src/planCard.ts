import { ActivityLike } from "@microsoft/spark.api";
import { Task } from "@repo/task-management-interfaces";

type StatusIcon = {
  type?: string;
  name?: string;
  size?: string;
  color?: string;
  style?: string;
};
export class PlanCard {
  private static getStatusIcon(
    status: string,
    overrides?: Partial<StatusIcon>
  ): StatusIcon {
    switch (status) {
      case "Done":
        return {
          type: "Icon",
          name: "CheckmarkCircle",
          size: "xSmall",
          color: "Good",
          style: "Filled",
          ...overrides,
        };
      case "InProgress":
        return {
          type: "Icon",
          name: "Clock",
          size: "xSmall",
          ...overrides,
        };
      case "Error":
        return {
          type: "Icon",
          name: "ErrorBadge",
          size: "xSmall",
          color: "Attention",
          ...overrides,
        };
      case "WaitingForUserResponse":
        return {
          type: "Icon",
          name: "ChatBubblesQuestion",
          size: "xSmall",
          color: "Warning",
          ...overrides,
        };
      default:
        return {
          type: "Icon",
          name: "Circle",
          size: "xSmall",
          ...overrides,
        };
    }
  }

  private static createTaskContainer(task: Task, subTasks: Task[]): any {
    const taskId = `task_${task.id}`;
    const isExpanded =
      (task.parentId === null && task.status !== "Done") ||
      task.status === "InProgress" ||
      task.status === "WaitingForUserResponse" ||
      task.status === "Error";
    return {
      type: "Container",
      separator: true,
      spacing: "ExtraLarge",
      items: [
        {
          type: "ColumnSet",
          columns: [
            {
              type: "Column",
              width: "auto",
              verticalContentAlignment: "Center",
              items: [this.getStatusIcon(task.status, { size: "xSmall" })],
            },
            {
              type: "Column",
              width: "stretch",
              items: [
                {
                  type: "ColumnSet",
                  columns: [
                    {
                      type: "Column",
                      width: "stretch",
                      items: [
                        {
                          type: "TextBlock",
                          text: task.title,
                          wrap: true,
                          style: "default",
                        },
                        {
                          type: "TextBlock",
                          text: isParent
                            ? `**Assigned to:** _@Conductor_`
                            : `**Assigned to:** _@${task.assignedTo ?? "Unassigned"}_`,
                          wrap: true,
                          isSubtle: true,
                          size: "Small",
                          spacing: "ExtraSmall",
                        },
                      ],
                      separator: true,
                    },
                    {
                      type: "Column",
                      width: "auto",
                      items: [
                        {
                          type: "Icon",
                          name: "ChevronDown",
                          size: "xSmall",
                          id: `${taskId}_chevronDown`,
                          isVisible: !isExpanded,
                          selectAction: {
                            type: "Action.ToggleVisibility",
                            targetElements: [
                              `${taskId}_details`,
                              `${taskId}_chevronUp`,
                              `${taskId}_chevronDown`,
                            ],
                          },
                        },
                        {
                          type: "Icon",
                          name: "ChevronUp",
                          size: "xSmall",
                          id: `${taskId}_chevronUp`,
                          isVisible: isExpanded,
                          selectAction: {
                            type: "Action.ToggleVisibility",
                            targetElements: [
                              `${taskId}_details`,
                              `${taskId}_chevronUp`,
                              `${taskId}_chevronDown`,
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          spacing: "ExtraLarge",
        },
        {
          type: "ColumnSet",
          id: `${taskId}_details`,
          isVisible: isExpanded,
          columns: [
            {
              type: "Column",
              width: "auto",
              items: [
                {
                  type: "Icon",
                  size: "xSmall",
                  name: "Blank",
                },
              ],
            },
            {
              type: "Column",
              width: "stretch",
              items: [
                {
                  type: "Container",
                  items: [
                    {
                      type: "TextBlock",
                      text: task.description,
                      wrap: true,
                      isSubtle: true,
                      weight: "Lighter",
                      size: "Small",
                      height: "stretch",
                      spacing: "None",
                    },
                    {
                      type: "TextBlock",
                      text: `**Status:** ${task.status}`,
                      wrap: true,
                      isSubtle: true,
                      size: "Small",
                      spacing: "ExtraSmall",
                    },
                    ...subTasks.map((task) =>
                      this.createTaskContainer(task, [])
                    ),
                  ],
                  spacing: "Small",
                },
              ],
            },
          ],
        },
      ],
    };
  }

  static createCard(
    parentTask: Task,
    subTasks: Task[],
    showApprovalButtons: boolean = false
  ): ActivityLike {
    const completedTasks = subTasks.filter(
      (task) => task.status === "Done"
    ).length;
    const totalTasks = subTasks.length;

    const body = [
      {
        type: "TextBlock",
        text: showApprovalButtons ? "Plan" : "Plan Progress",
        wrap: true,
        weight: "Bolder",
        size: "Large",
      },
      {
        type: "ColumnSet",
        columns: [
          {
            type: "Column",
            width: "auto",
            verticalContentAlignment: "Center",
            items: [this.getStatusIcon(parentTask.status)],
          },
          {
            type: "Column",
            width: "auto",
            items: [
              {
                type: "TextBlock",
                text: `_${completedTasks} of ${totalTasks} tasks completed_`,
                wrap: true,
                size: "Small",
                spacing: "None",
                isSubtle: true,
                horizontalAlignment: "Left",
              },
            ],
            verticalContentAlignment: "Center",
          },
        ],
        spacing: "None",
        minHeight: "5px",
      },
      this.createTaskContainer(parentTask, subTasks, true),
    ];

    if (showApprovalButtons) {
      (body as any[]).push(
        {
          type: "TextBlock",
          text: "Does this plan look good?",
          wrap: true,
          separator: true,
        },
        {
          type: "ActionSet",
          actions: [
            {
              type: "Action.Execute",
              title: "Approve",
              verb: "approve",
              style: "positive",
              data: { taskId: parentTask.id },
            },
            {
              type: "Action.Execute",
              title: "Deny",
              verb: "deny",
              style: "destructive",
              data: { taskId: parentTask.id },
            },
          ],
        }
      );
    }

    return {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            type: "AdaptiveCard",
            $schema: "https://adaptivecards.io/schemas/adaptive-card.json",
            version: "1.5",
            body,
          },
        },
      ],
    };
  }
}
