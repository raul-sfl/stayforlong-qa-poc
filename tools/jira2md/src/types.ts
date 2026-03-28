// Atlassian Document Format (ADF) types
// https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface AdfDoc {
  type: 'doc';
  version: number;
  content: AdfNode[];
}

// Jira REST API response (subset of fields we need)
export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    issuetype: { name: string };
    description: AdfDoc | null;
    labels?: string[];
    priority?: { name: string };
  };
}

// Extracted QA section from a Jira issue
export interface QASection {
  heading: string;       // original heading text (e.g. "QA Requirements")
  steps: string[];       // extracted test steps / criteria
}

// Final output
export interface MarkdownSpec {
  issueKey: string;
  title: string;
  sourceUrl: string;
  qaSection: QASection;
}

// CLI options
export interface CLIOptions {
  output: string;
  dryRun: boolean;
  verbose: boolean;
  aiEnhance: boolean;
  model: string;
  jiraUrl: string;
  baseUrl: string;
}
