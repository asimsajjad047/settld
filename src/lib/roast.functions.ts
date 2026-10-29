import { createServerFn } from "@tanstack/react-start";
import { generateChatCompletion } from "@lovable.dev/ai-gateway";

type In = { key: string; title: string; name: string; detail: string };

const RULES = `You write one short, friendly, PG roast line for each dinner-table award.
Max 12 words per line. Playful teasing about the award only (food, sharing, speed of paying).
Never mention appearance, identity, or how much money someone has or earns.`;

// Public (no login): one roast line per award.
export const roastAwards = createServerFn({ method: "POST" })
  .inputValidator((input: { awards: In[] }) => {
    if (!Array.isArray(input?.awards) || input.awards.length > 10) throw new Error("Bad awards");
    return { awards: input.awards.map((a) => ({ key: String(a.key).slice(0, 200), title: String(a.title).slice(0, 80), name: String(a.name).slice(0, 60), detail: String(a.detail).slice(0, 80) })) };
  })
  .handler(async ({ data }): Promise<{ lines: Record<string, string> }> => {
    if (!data.awards.length) return { lines: {} };
    const res = await generateChatCompletion({
      model: "google/gemini-3.8-flash",
      messages: [
        { role: "system", content: RULES },
        { role: "user", content: JSON.stringify(data.awards) },
      ],
      tools: [{
        type: "function",
        function: {
          name: "roast_lines",
          description: "One roast line per award key.",
          parameters: {
            type: "object",
            properties: {
              lines: { type: "array", items: { type: "object", properties: { key: { type: "string" }, line: { type: "string" } }, required: ["key", "line"] } },
            },
            required: ["lines"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "roast_lines" } },
    });
    const call = res.choices?.[0]?.message?.tool_calls?.[0];
    const args = call && "function" in call ? call.function.arguments : undefined;
    if (!args) throw new Error("No lines");
    const parsed = JSON.parse(args) as { lines?: { key?: unknown; line?: unknown }[] };
    const keys = new Set(data.awards.map((a) => a.key));
    const lines: Record<string, string> = {};
    for (const l of parsed.lines ?? []) {
      if (typeof l.key === "string" && keys.has(l.key) && typeof l.line === "string") {
        lines[l.key] = l.line.trim().split(/\s+/).slice(0, 12).join(" ");
      }
    }
    return { lines };
  });
