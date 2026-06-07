import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function WarRoomPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Campaign War Room"
      title="Campaign War Room"
      toolId="tool_9"
      endpoint="/api/v1/warroom/*"
      description="Review campaign health, live alerts, risks, and operational recommendations."
    />
  );
}
