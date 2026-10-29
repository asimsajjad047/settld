import { createServerFn } from "@tanstack/react-start";
import { generateChatCompletion } from "@lovable.dev/ai-gateway";

type InItem = { id: string; name: string; price_pence: number; claimed_by: number };

const RULES = `A guest at a restaurant says what they ate. Pick the bill items this guest should claim.
- Match dish names loosely: synonyms, typos, partial names ("naan" = "Garlic Naan", "chai" = "Masala Chai").
- "half the X", "shared the X" or "some of the X" means claim X (the split happens because everyone who shared it claims it).
- When there are identical rows (e.g. two "Garlic Naan") and the guest says "a naan", pick one with claimed_by 0 first. "both naans" means both rows.
- Never invent items; only return ids from the list. Return an empty list if nothing matches.`;

// Public (no login): maps a guest's free text to bill item ids.
export const matchClaims = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string; items: InItem[] }) => {
    if (typeof input?.text !== "string" || !input.text.trim() || input.text.length > 1000) throw new Error("Say what you had.");
    if (!Array.isArray(input.items) || input.items.length > 300) throw new Error("Bad items");
    const items = input.items.map((i) => ({
      id: String(i.id), name: String(i.name).slice(0, 200),
      price_pence: Math.round(Number(i.price_pence)) || 0, claimed_by: Math.round(Number(i.claimed_by)) || 0,
    }));
    return { text: input.text.trim(), items };
  })
  .handler(async ({ data }): Promise<{ item_ids: string[] }> => {
    const res = await generateChatCompletion({
      model: "google/gemini-3.8-flash",
      messages: [
        { role: "system", content: RULES },
        { role: "user", content: `Bill items:\n${JSON.stringify(data.items)}\n\nGuest said: "${data.text}"` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "claim_items",
          description: "Return the ids of the items this guest should claim.",
          parameters: {
            type: "object",
            properties: { item_ids: { type: "array", items: { type: "string" } } },
            required: ["item_ids"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "claim_items" } },
    });
    const call = res.choices?.[0]?.message?.tool_calls?.[0];
    const args = call && "function" in call ? call.function.arguments : undefined;
    if (!args) return { item_ids: [] };
    const parsed = JSON.parse(args) as { item_ids?: unknown };
    const valid = new Set(data.items.map((i) => i.id));
    const ids = Array.isArray(parsed.item_ids) ? parsed.item_ids.filter((x): x is string => typeof x === "string" && valid.has(x)) : [];
    return { item_ids: [...new Set(ids)] };
  });
