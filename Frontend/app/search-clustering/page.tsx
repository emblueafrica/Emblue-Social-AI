import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function SearchClusteringPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Search & Clustering"
      title="Search & Clustering"
      toolId="tool_2"
      endpoint="/api/v1/cluster, /api/v1/strategize"
      description="Group conversations into opportunities and generate content strategy from listening data."
    />
  );
}
