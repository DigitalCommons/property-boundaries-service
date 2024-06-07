/** Use this to store the current pipeline key */
let pipelineKey: string;

export function getRunningPipelineKey(): string {
  return pipelineKey || "NO_PIPELINE_KEY_FOUND";
}

export function setRunningPipelineKey(key: string): void {
  pipelineKey = key;
}
