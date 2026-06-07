import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function ListeningPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Advanced Listening"
      title="Advanced Listening"
      toolId="tool_1"
      endpoint="/api/v1/listening/*"
      description="Monitor social conversations, keyword groups, search runs, and high-priority mentions."
    />
  );
}
