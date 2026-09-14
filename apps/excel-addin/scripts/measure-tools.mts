// One-off audit helper: measure the tool wire-format (descriptions + JSON
// schemas) the model receives every request. Run: npx vite-node scripts/measure-tools.mts
import { createToolRegistry } from "../src/core/tools/registry";
import {
  askUserQuestionTool,
  screenshotTools,
  enterPlanModeTool,
  findSkillTool,
  loadSkillTool,
  memoryTools,
  planTools,
  proposeSkillTool,
  readSkillResourceTool,
  readTools,
  runExcelScriptTool,
  spawnSubagentTool,
  todoWriteTool,
  workbookSettingsTools,
  writeTools,
} from "../src/core/tools";

const registry = createToolRegistry([
  ...readTools,
  ...writeTools,
  ...screenshotTools,
  ...planTools,
  spawnSubagentTool,
  readSkillResourceTool,
  findSkillTool,
  loadSkillTool,
  ...memoryTools,
  ...workbookSettingsTools,
  enterPlanModeTool,
  askUserQuestionTool,
  runExcelScriptTool,
  todoWriteTool,
  proposeSkillTool,
]);

const wire = registry.toWireFormat();
const rows = wire
  .map((t) => {
    const total = JSON.stringify(t).length;
    const desc = (t as any).function.description?.length ?? 0;
    return { name: (t as any).function.name, desc, total, tokens: Math.round(total / 4) };
  })
  .sort((a, b) => b.total - a.total);

let sum = 0;
console.log("tool".padEnd(28) + "desc chars".padStart(11) + "wire chars".padStart(11) + "~tokens".padStart(9));
for (const r of rows) {
  sum += r.total;
  console.log(r.name.padEnd(28) + String(r.desc).padStart(11) + String(r.total).padStart(11) + String(r.tokens).padStart(9));
}
console.log("TOTAL".padEnd(28) + "".padStart(11) + String(sum).padStart(11) + String(Math.round(sum / 4)).padStart(9));
