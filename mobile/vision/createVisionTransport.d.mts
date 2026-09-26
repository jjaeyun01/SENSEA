import type { DescribeRequest } from "./LatestVisionController.mjs";
export function createVisionTransport(options: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  formDataFactory?: () => { append: (name: string, value: unknown) => void };
}): (request: DescribeRequest) => Promise<unknown>;
