import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function CommentMiningPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Comment Mining"
      title="Comment Mining"
      toolId="tool_8"
      endpoint="/api/v1/insights/*"
      description="Extract FAQs, pain points, and customer language from comment history."
    />
  );
}
