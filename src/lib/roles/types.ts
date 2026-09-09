/** The seed roles this board's own contracts still name: the editor's local
    fallback, the pipeline stage schema and the MCP `role` enum. The console's
    catalog can hold MORE than these — an additional role is read, edited and
    launched through `src/lib/roles/catalog.ts`, and the consumers frozen to
    this list refuse it explicitly rather than after a launch. */
export const ROLE_IDS = [
  "orchestrator",
  "reviewer",
  "verifier",
  "builder",
  "architect",
  "cleaner",
  "prod-auditor",
  "deployer",
] as const;

export type RoleId = typeof ROLE_IDS[number];

export type RoleEngine = "claude" | "codex";

export type RoleConfig = {
  engine: RoleEngine;
  model: string;
  effort: string;
};

type RoleParameterBase = {
  key: string;
  label: string;
  description: string;
  required?: boolean;
};

export type RoleParameter = RoleParameterBase & ({
  kind: "text";
  default?: string;
} | {
  kind: "integer";
  default?: number;
  min?: number;
  max?: number;
} | {
  kind: "select";
  default?: string;
  options?: readonly string[];
});

export type RoleDefinition = {
  /** A catalog id: one of `ROLE_IDS`, or a role the operator created in the
      console. Consumers that only accept a seed id check `ROLE_IDS`. */
  id: string;
  name: string;
  description: string;
  config: RoleConfig;
  parameters: readonly RoleParameter[];
  promptScaffold: string;
  safetyFences: readonly string[];
  capabilities: readonly ("read-only" | "production-read" | "production-write" | "spawn")[];
};

export type RoleOverride = {
  config?: Partial<RoleConfig>;
  promptScaffold?: string;
};

export type RoleOverridesFile = {
  schemaVersion: 1;
  overrides: Partial<Record<RoleId, RoleOverride>>;
};

export type RoleParamValues = Record<string, string | number>;

export type ResolvedRole = {
  definition: RoleDefinition;
  config: RoleConfig;
  params: RoleParamValues;
  "prompt": string;
  requiresDeploymentConfirmation: boolean;
};
