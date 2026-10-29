import { createServerFn } from "@tanstack/react-start";
import { generateChatCompletion } from "@lovable.dev/ai-gateway";

export type ParsedReceipt = {
  restaurant_name: string;
  items: { name: string; quantity: number; line_total_pence: number }[];
  service_charge_pence: number | null;
  discount_pence: number | null;
  receipt_total_pence: number | null;
};

const PROMPT = `These photos are parts of ONE receipt, in order, and may overlap. Return each line item exactly once: if a line appears in two photos, include it once.
All prices are integer pence. line_total_pence is the printed line price: for "2 x Burger @ 12.95  25.90" that is quantity 2 and line_total_pence 2590, never the @ unit price.
Ignore subtotal, net and VAT summaries, payment/card lines, table numbers and covers.
A printed service or "optional gratuity" line goes in service_charge_pence, never in items (null if none).
Discounts go in discount_pence as a positive number, never in items (null if none).
receipt_total_pence is the final printed total (null if not visible).`;

const nullableInt = { anyOf: [{ type: "integer" }, { type: "null" }] };

// Public (no login): reads receipt photos and returns structured items in integer pence. Photos are not stored.
export const parseReceipt = createServerFn({ method: "POST" })
  .inputValidator((input: { images: string[] }) => {
    const imgs = input?.images;
    if (!Array.isArray(imgs) || imgs.length < 1 || imgs.length > 4 ||
      !imgs.every((i) => typeof i === "string" && i.startsWith("data:image/") && i.length < 12_000_000)) {
      throw new Error("Send 1–4 image data URLs.");
    }
    return { images: imgs };
  })
  .handler(async ({ data }): Promise<ParsedReceipt> => {
    const res = await generateChatCompletion({
      model: "google/gemini-3.8-flash",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          ...data.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      }],
      tools: [{
        type: "function",
        function: {
          name: "return_receipt",
          description: "Return the parsed receipt.",
          parameters: {
            type: "object",
            properties: {
              restaurant_name: { type: "string" },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    quantity: { type: "integer" },
                    line_total_pence: { type: "integer" },
                  },
                  required: ["name", "quantity", "line_total_pence"],
                },
              },
              service_charge_pence: nullableInt,
              discount_pence: nullableInt,
              receipt_total_pence: nullableInt,
            },
            required: ["restaurant_name", "items", "service_charge_pence", "discount_pence", "receipt_total_pence"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "return_receipt" } },
    });
    const call = res.choices?.[0]?.message?.tool_calls?.[0];
    const args = call && "function" in call ? call.function.arguments : undefined;
    if (!args) throw new Error("No receipt found");
    const p = JSON.parse(args) as ParsedReceipt;
    if (!Array.isArray(p.items)) throw new Error("No receipt found");
    return p;
  });
