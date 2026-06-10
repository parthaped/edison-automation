export interface WorkbenchCredentials {
  username: string;
  password: string;
}

export function getWorkbenchCredentials(
  env: NodeJS.ProcessEnv = process.env,
): WorkbenchCredentials {
  return {
    username: env.WORKBENCH_DEV_USERNAME?.trim() || "edison-admin",
    password: env.WORKBENCH_DEV_PASSWORD?.trim() || "edison-dev-2026",
  };
}

export function validateWorkbenchLogin(
  username: string,
  password: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = getWorkbenchCredentials(env);
  return (
    username === expected.username &&
    password === expected.password
  );
}
