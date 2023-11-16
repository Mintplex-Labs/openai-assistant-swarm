import OpenAI from "openai";
import { Assistant } from "openai/resources/beta/assistants/assistants";

export type EventTypes =
  | "debug"
  | "child_assistants_complete"
  | "parent_assistant_complete"
  | "parent_text_response";

export type AssistantListResponse = {
  data: Assistant[];
  hasNextPage: () => boolean;
};

export type ManagerOptions = {
  debug: boolean;
  managerAssistantOptions?: {
    name: string;
    model: string | "gpt-3.5-turbo";
    instructions?: string;
  };
};

export type DelegationArguments = {
  prompt: string;
  agent_id: string | "<none>";
};

export type DelegatedToolCall = {
  id: string;
  function: string;
  agentId: string;
  args: DelegationArguments;
};

export type DelegationResponse = {
  concludedPrimaryRun: ParentResponseEvent["parentRun"];
  subRuns: DelegateRun[];
};

export type MessageHistory = {
  role: "user";
  content: string;
};

export type DelegateRun = {
  status: "success" | "failed";
  assistant: Assistant | null;
  parentRun: OpenAI.Beta.Threads.Run;
  parentToolCallId: OpenAI.Beta.Threads.Runs.FunctionToolCall["id"];
  thread: OpenAI.Beta.Thread | null;
  run: OpenAI.Beta.Threads.Run | null;
  abortReason: string | null;
  textResponse: string | null;
  playground: string | null;
};

export type ParentResponseEvent = {
  parentRun: OpenAI.Beta.Threads.Run & {
    playground: string | null;
    textResponse: string | null;
  };
};

export type SubRunResponseEvent = {
  subRuns: DelegateRun[];
};
