import { JiraIssue } from './types.js';

interface JiraConfig {
  baseUrl: string;    // e.g. https://stayforlong.atlassian.net
  email: string;
  apiToken: string;
}

function getConfig(): JiraConfig {
  const baseUrl = process.env.JIRA_BASE_URL ?? '';
  const email = process.env.JIRA_EMAIL ?? '';
  const apiToken = process.env.JIRA_API_TOKEN ?? '';

  const missing: string[] = [];
  if (!baseUrl) missing.push('JIRA_BASE_URL');
  if (!email) missing.push('JIRA_EMAIL');
  if (!apiToken) missing.push('JIRA_API_TOKEN');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Set them in your shell or in a .env file:\n` +
      `  JIRA_BASE_URL=https://yourcompany.atlassian.net\n` +
      `  JIRA_EMAIL=you@yourcompany.com\n` +
      `  JIRA_API_TOKEN=your-api-token`
    );
  }

  return { baseUrl: baseUrl.replace(/\/$/, ''), email, apiToken };
}

export async function fetchIssue(issueKey: string): Promise<JiraIssue> {
  const config = getConfig();
  const url = `${config.baseUrl}/rest/api/3/issue/${issueKey}?fields=summary,description,status,issuetype,labels,priority`;

  const credentials = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');

  const response = await fetch(url, {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        `Jira authentication failed (401). Check JIRA_EMAIL and JIRA_API_TOKEN.\n` +
        `Generate a token at: https://id.atlassian.com/manage-profile/security/api-tokens`
      );
    }
    if (response.status === 404) {
      throw new Error(`Jira issue '${issueKey}' not found. Check the issue key and JIRA_BASE_URL.`);
    }
    const body = await response.text();
    throw new Error(`Jira API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<JiraIssue>;
}

export function issueUrl(issueKey: string): string {
  const config = getConfig();
  return `${config.baseUrl}/browse/${issueKey}`;
}
