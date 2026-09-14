import type { TodoItem } from "./useAgentStream";

interface TodoCardProps {
  item: TodoItem;
}

/**
 * Inline checklist card. Distinct from PlanCard (which gates Work mode);
 * this is informal task-tracking the agent maintains during longer work.
 * Each `todo_write` call updates the tasks in place.
 */
export function TodoCard({ item }: TodoCardProps) {
  const done = item.tasks.filter((t) => t.status === "done").length;
  const inProgress = item.tasks.find((t) => t.status === "in-progress");

  return (
    <div className="todo-card" role="status">
      <div className="todo-card__header">
        <span className="todo-card__icon" aria-hidden="true">
          ✓
        </span>
        <span className="todo-card__title">Tasks</span>
        <span className="todo-card__count">
          {done}/{item.tasks.length}
        </span>
      </div>
      <ul className="todo-card__list">
        {item.tasks.map((task, i) => (
          <li
            key={i}
            className={`todo-card__task todo-card__task--${task.status}${
              task === inProgress ? " is-current" : ""
            }`}
          >
            <span className="todo-card__marker">{markerFor(task.status)}</span>
            <span className="todo-card__text">{task.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function markerFor(status: "pending" | "in-progress" | "done"): string {
  switch (status) {
    case "done":
      return "✓";
    case "in-progress":
      return "▶";
    default:
      return "○";
  }
}
