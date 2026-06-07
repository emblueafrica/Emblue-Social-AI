import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function FunnelsPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Comment to DM Funnel"
      title="Comment to DM Funnel"
      toolId="tool_4"
      endpoint="/api/v1/funnels/*"
      description="Create comment-triggered DM campaigns, templates, funnel metrics, and conversion events."
    />
  );
}
