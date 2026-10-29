import { createFileRoute } from "@tanstack/react-router";
import { TableApp } from "@/components/TableApp";

export const Route = createFileRoute("/t/$code/")({
  head: ({ params }) => ({
    meta: [
      { title: `Table ${params.code} — Settld` },
      { name: "description", content: "Tap what you had, see your share and pay the host back." },
      { property: "og:title", content: `Join table ${params.code} on Settld` },
      { property: "og:description", content: "Tap what you had, see your share and pay the host back." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TablePage,
});

function TablePage() {
  const { code } = Route.useParams();
  return <TableApp code={code.toUpperCase()} />;
}
