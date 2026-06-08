import { getOcrWorkerSecret } from "./ocr-queue-config";

export function isAuthorizedOcrWorker(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = getOcrWorkerSecret(env);
  if (!expected) {
    return false;
  }
  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${expected}`) {
    return true;
  }
  return request.headers.get("x-edison-ocr-worker-secret") === expected;
}
