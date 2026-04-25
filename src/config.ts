import { z } from "zod";

const envSchema = z
  .object({
    // Jira
    JIRA_BASE_URL: z.string().url().optional(),
    JIRA_AUTH_TOKEN: z.string().min(1).optional(),
    JIRA_EMAIL: z.string().email().optional(),

    // GitHub
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_PRIVATE_KEY: z.string().min(1).optional(),
    GITHUB_INSTALLATION_ID: z.string().min(1).optional(),
    GITHUB_PAT: z.string().min(1).optional(),

    // AWS
    AWS_REGION: z.string().min(1).default("us-east-1"),
    AWS_ROLE_ARN: z.string().min(1).optional(),

    // Nexus
    NEXUS_PUBLIC_BASE_URL: z.string().url().optional(),
    NEXUS_TRANSPORT: z.enum(["stdio", "sse"]).optional(),
    NEXUS_HOST: z.string().min(1).optional(),
    NEXUS_PORT: z.string().min(1).optional(),
  })
  .passthrough();

export class Config {
  readonly jiraBaseUrl?: string;
  readonly jiraAuthToken?: string;
  readonly jiraEmail?: string;

  readonly githubAppId?: string;
  readonly githubPrivateKey?: string;
  readonly githubInstallationId?: string;
  readonly githubPat?: string;

  readonly awsRegion: string;
  readonly awsRoleArn?: string;

  readonly nexusPublicBaseUrl?: string;

  private constructor(data: {
    jiraBaseUrl?: string;
    jiraAuthToken?: string;
    jiraEmail?: string;
    githubAppId?: string;
    githubPrivateKey?: string;
    githubInstallationId?: string;
    githubPat?: string;
    awsRegion: string;
    awsRoleArn?: string;
    nexusPublicBaseUrl?: string;
  }) {
    this.jiraBaseUrl = data.jiraBaseUrl;
    this.jiraAuthToken = data.jiraAuthToken;
    this.jiraEmail = data.jiraEmail;
    this.githubAppId = data.githubAppId;
    this.githubPrivateKey = data.githubPrivateKey;
    this.githubInstallationId = data.githubInstallationId;
    this.githubPat = data.githubPat;
    this.awsRegion = data.awsRegion;
    this.awsRoleArn = data.awsRoleArn;
    this.nexusPublicBaseUrl = data.nexusPublicBaseUrl;
  }

  static fromEnv(env: NodeJS.ProcessEnv): Config {
    const parsed = envSchema.safeParse(env);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment: ${msg}`);
    }

    const e = parsed.data;
    return new Config({
      jiraBaseUrl: e.JIRA_BASE_URL,
      jiraAuthToken: e.JIRA_AUTH_TOKEN,
      jiraEmail: e.JIRA_EMAIL,
      githubAppId: e.GITHUB_APP_ID,
      githubPrivateKey: e.GITHUB_PRIVATE_KEY,
      githubInstallationId: e.GITHUB_INSTALLATION_ID,
      githubPat: e.GITHUB_PAT,
      awsRegion: e.AWS_REGION,
      awsRoleArn: e.AWS_ROLE_ARN,
      nexusPublicBaseUrl: e.NEXUS_PUBLIC_BASE_URL,
    });
  }

  requireJira(): { baseUrl: string; email: string; authToken: string } {
    if (!this.jiraBaseUrl || !this.jiraEmail || !this.jiraAuthToken) {
      throw new Error(
        "Jira credentials not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_AUTH_TOKEN.",
      );
    }
    return { baseUrl: this.jiraBaseUrl, email: this.jiraEmail, authToken: this.jiraAuthToken };
  }

  requireGitHub(): GitHubAuthConfig {
    if (this.githubPat) {
      return { mode: "pat", token: this.githubPat };
    }

    if (this.githubAppId && this.githubPrivateKey && this.githubInstallationId) {
      return {
        mode: "app",
        appId: this.githubAppId,
        privateKey: this.githubPrivateKey,
        installationId: this.githubInstallationId,
      };
    }

    throw new Error(
      "GitHub credentials not configured. Set GITHUB_PAT or (GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_INSTALLATION_ID).",
    );
  }
}

export type GitHubAuthConfig =
  | { mode: "pat"; token: string }
  | { mode: "app"; appId: string; privateKey: string; installationId: string };
