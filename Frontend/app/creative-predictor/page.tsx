import { ToolWorkspacePage } from "@/components/ToolWorkspacePage";

export default function CreativePredictorPage() {
  return (
    <ToolWorkspacePage
      activeLabel="Creative Predictor"
      title="Creative Predictor"
      toolId="tool_7"
      endpoint="/api/v1/creative/*"
      description="Score captions and creative concepts before publishing, with improvement recommendations."
    />
  );
}
