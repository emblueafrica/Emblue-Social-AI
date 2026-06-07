import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function AttributionPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Attribution & Links"
      title="Attribution & Links"
      toolId="tool_6"
      endpoint="/api/v1/attribution/*"
      description="Track campaign links, clicks, conversions, and attributed social revenue."
    />
  );
}
