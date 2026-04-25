import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { Config } from "../config.js";

export async function createCloudWatchLogsClient(config: Config): Promise<CloudWatchLogsClient> {
  const region = config.awsRegion;
  if (!config.awsRoleArn) return new CloudWatchLogsClient({ region });

  const sts = new STSClient({ region });
  const resp = await sts.send(
    new AssumeRoleCommand({
      RoleArn: config.awsRoleArn,
      RoleSessionName: `nexus-${Date.now()}`,
      DurationSeconds: 3600,
    }),
  );

  const creds = resp.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error("Failed to assume role: missing temporary credentials in STS response.");
  }

  return new CloudWatchLogsClient({
    region,
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
      expiration: creds.Expiration,
    },
  });
}

