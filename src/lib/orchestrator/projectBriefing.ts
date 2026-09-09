import { agentRegistry } from "@/lib/agent/registry";
import { cachedOrgBridge } from "@/lib/projects/orgBridge";

/*
 * What a project seat is told about ITS OWN project, composed at delivery.
 *
 * The default mandate used to be the same page of text for every project: it
 * named no firm, no checkout, no repository, no MCP server the project may
 * reach, no rule the operator had written down — so a fresh seat's first
 * message could only be a generic "tell me what to ship", and the operator had
 * to hand-feed it everything the console already knew.
 *
 * The console owns that layer, so this reads what the console said rather than
 * inventing a second store. It reads it from the org bridge's memo or cache,
 * and NEVER by calling the console: `seatSpawnConsole.test.ts` holds the seat
 * path to zero console calls, because a console that hangs would otherwise
 * stop the seat that could repair it. A cold cache therefore yields no
 * briefing at all, and the mandate is delivered exactly as it was before —
 * which is the honest outcome, not a degraded one.
 *
 * Two things stay out on purpose:
 *
 *  - secret VALUES. Names and kinds are enough to say what exists; a value
 *    reaches an agent through the console's `secret_share` on its project or
 *    firm, never by being pasted into a mandate that is then stored, replayed
 *    on rotation and carried into a handoff digest.
 *  - memory and past failures. sessionmem and the transcript index are LIVE
 *    and belong to the seat's first turn, not to the seat's creation minutes
 *    or hours earlier. The briefing names the queries; the mandate's first-turn
 *    contract requires them to be run before the seat speaks.
 */

/** Hard bound on the composed block. `launchOverheadBytes` reserves exactly
    this much, so a mandate that passes preflight cannot be pushed past the
    structured envelope by a briefing that turned out large. */
export const PROJECT_BRIEFING_BUDGET_BYTES = 4_096;

export const PROJECT_BRIEFING_HEADING = "## This project, before you ask the operator anything";

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** Truncates on a whole line: half a sentence about what a project may reach
    reads as a fact with its qualifier cut off. */
function trimToBudget(text: string): string {
  if (byteLength(text) <= PROJECT_BRIEFING_BUDGET_BYTES) return text;
  const notice = "\n(briefing truncated to fit the delivery envelope; read the rest through the console)";
  const bound = PROJECT_BRIEFING_BUDGET_BYTES - byteLength(notice);
  const kept: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const cost = byteLength(line) + 1;
    if (used + cost > bound) break;
    kept.push(line);
    used += cost;
  }
  return `${kept.join("\n")}${notice}`;
}

function grantLine(rows: { item: string; from: string }[] | undefined, empty: string): string {
  const items = (rows ?? []).map((row) => (row.from === "project" ? row.item : `${row.item} (${row.from})`));
  return items.length ? items.join(", ") : empty;
}

/** How many conversations the board already holds for this project. The seat
    is told there is history here before it searches, which is the difference
    between a seat that reads and one that asks. */
function conversationCount(project: string): number {
  try {
    return Object.values(agentRegistry().readOnlySnapshot().conversations)
      .filter((conversation) => conversation.projectOwnership?.project === project
        || conversation.generations.some((generation) => generation.launchProfile?.project === project))
      .length;
  } catch {
    return 0;
  }
}

/** The block appended to a project seat's mandate at delivery, or null when
    this machine cannot say anything true about the project. */
export function projectBriefing(project: string): string | null {
  const trimmed = project?.trim();
  if (!trimmed) return null;

  const bridge = cachedOrgBridge();
  const org = bridge?.byBoardId.get(trimmed);
  if (!org) return null;

  const lines: string[] = [PROJECT_BRIEFING_HEADING, ""];
  lines.push(`The console records this project as ${org.projectName} (\`${org.project}\`), owned by ${org.firmName} (\`${org.firm}\`).`);
  if (org.path) lines.push(`Its checkout is \`${org.path}\` — that is your working directory unless the operator names another.`);
  if (org.repo) lines.push(`Its repository is ${org.repo}.`);
  const elsewhere = (org.paths ?? []).filter((candidate) => candidate && candidate !== org.path);
  if (elsewhere.length) lines.push(`The same project sits at ${elsewhere.map((candidate) => `\`${candidate}\``).join(", ")} on other machines.`);
  if (org.note) lines.push(`The operator's note on it: ${org.note}`);

  lines.push("", "### What this project may actually reach");
  lines.push(`- MCP servers: ${grantLine(org.grants, "none granted — say so rather than assuming a server is there")}`);
  lines.push(`- Skills: ${grantLine(org.skills, "none granted")}`);
  lines.push(
    org.secretNames?.length
      ? `- Secrets shared with it, by name only: ${org.secretNames.join(", ")}. A value reaches an agent through the console's \`secret_share\` on this project or its firm — never by being pasted into a prompt, a report or a file.`
      : "- Secrets: none are shared with this project yet. If a task needs one, ask the operator to add it in the console rather than accepting a pasted value.",
  );
  lines.push(
    org.ruleCount
      ? `- Standing rules: ${org.ruleCount} written for this project and its firm. Read them with the console (\`project_show\` for \`${org.project}\`) in your first turn — they come from the operator and outrank your own habits, though not this mandate's fences.`
      : "- Standing rules: none written yet. Part of the setup pass below is asking the operator which ones this project needs, and recording them in the console.",
  );

  const conversations = conversationCount(trimmed);
  lines.push("", "### Memory — read it before your first message, not after");
  lines.push(
    conversations > 0
      ? `The board already holds ${conversations} conversation${conversations === 1 ? "" : "s"} for this project. That is history you are expected to have read, not context the operator should have to repeat.`
      : "The board holds no conversation for this project yet, so its history lives in the memory tools rather than on the board.",
  );
  lines.push(
    `Before you write anything to the operator, run: \`search_transcripts\` for \`${org.projectName}\` and for the repository name, scoped to this project first and then unscoped; \`sessions_search\` in sessionmem for the same, then \`session_show\` on the hits worth opening; and jeeves-rag where the project has knowledge-base material. Ask sessionmem specifically for what BROKE here — its cards carry a \`broke\` list, and this project's failures are the part of its history nobody writes down twice.`,
  );
  lines.push("Open your first message with what you found: the last sessions by title and date, and the failures worth not repeating. Found nothing? Say so plainly — an invented history is worse than an empty one.");

  return trimToBudget(lines.join("\n"));
}

/** Appends a briefing to a mandate at delivery, at most once. The stored
    mandate stays raw — a briefing is a snapshot of a layer the operator keeps
    editing, so it is composed on the way out and never frozen into the record
    a rotation replays. */
export function withProjectBriefing(mandate: string, briefing: string | null): string {
  if (!briefing) return mandate;
  if (mandate.includes(PROJECT_BRIEFING_HEADING)) return mandate;
  return `${mandate}\n\n${briefing}`;
}
