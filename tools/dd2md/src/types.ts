// Datadog Synthetics Browser Test JSON structure

export interface DDLocatorValue {
  type: 'css' | 'xpath';
  value: string;
}

export interface DDUserLocator {
  values: DDLocatorValue[];
  failTestOnCannotLocate?: boolean;
}

export interface DDElement {
  userLocator?: DDUserLocator;
  multiLocator?: {
    ab?: string;   // positional XPath
    at?: string;   // XPath
    cl?: string;   // class-based XPath
    co?: string;
    ro?: string;   // role/class XPath (most readable)
    clt?: string;  // alternative class XPath
    css?: string;
    xp?: string;
  };
  targetOuterHTML?: string;  // outer HTML of the element (contains data-testid, aria etc.)
  url?: string;              // page URL where element is located
}

export interface DDStepParams {
  value?: string;
  element?: DDElement;
  attribute?: string;
  x?: number;
  y?: number;
  variable?: { name: string };
  operator?: string;
  check?: string;
}

export interface DDStep {
  name: string;
  type: string;
  params: DDStepParams;
  isCritical?: boolean;
  allowFailure?: boolean;
  timeout?: number;      // in seconds
  noScreenshot?: boolean;
}

export interface DDConfig {
  request: {
    method: string;
    url: string;
  };
  variables?: Array<{ name: string; type: string }>;
  assertions?: unknown[];
  setCookies?: string;
}

export interface DDOptions {
  tick_every?: number;
  device_ids?: string[];
  browser_steps?: DDStep[];
}

export interface DDTest {
  type: 'browser';
  name: string;
  status?: string;
  locations?: string[];
  tags?: string[];
  config: DDConfig;
  options: DDOptions;
  steps?: DDStep[];   // top-level steps (API v2 variant)
}

// Internal representation before rendering

export interface MarkdownTest {
  title: string;
  sourceFile: string;
  steps: string[];
  aiEnhanced?: boolean;
  model?: string;
  viewport?: 'mobile' | 'tablet' | 'desktop';
}

export interface CLIOptions {
  output: string;
  dryRun: boolean;
  verbose: boolean;
  aiEnhance: boolean;
  model: string;
}
