import path from "path";

export function getAppDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
) {
  const configuredDirectory = env.APP_DATA_DIR?.trim();

  return configuredDirectory
    ? path.resolve(cwd, configuredDirectory)
    : path.join(cwd, "data");
}
