import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { Config } from "../config.js";

export async function createOctokit(config: Config): Promise<Octokit> {
  const gh = config.requireGitHub();
  if (gh.mode === "pat") {
    return new Octokit({ auth: gh.token });
  }

  const appId = Number(gh.appId);
  const installationId = Number(gh.installationId);
  if (!Number.isFinite(appId) || !Number.isFinite(installationId)) {
    throw new Error("GitHub App credentials invalid. GITHUB_APP_ID and GITHUB_INSTALLATION_ID must be numbers.");
  }

  const auth = createAppAuth({
    appId,
    privateKey: gh.privateKey.replace(/\\n/g, "\n"),
    installationId,
  });

  const installationAuthentication = await auth({ type: "installation" });
  return new Octokit({ auth: installationAuthentication.token });
}
