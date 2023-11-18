import { Assistant } from "openai/resources/beta/assistants/assistants";
import {
  AssistantListResponse,
  MessageHistory,
  RunSubmitToolTempOutput,
} from "./types";
import SwarmManager from "../manager";
import OpenAI from "openai";
import { RunSubmitToolOutputsParams } from "openai/resources/beta/threads/runs/runs";

export const DEFAULT_OPTS = {
  debug: false,
  managerAssistantOptions: {
    name: "[AUTOMATED] ___Swarm Manager",
    model: "gpt-3.5-turbo",
  },
};

/**
 * Given a list of assistants, create a prompt to manage them that works for most model.
 */
export function toolsFromAssistants(
  assistants: Assistant[] = [],
): Assistant.Function[] {
  return [
    {
      type: "function",
      function: {
        name: "delegate",
        description:
          "Delegates tasks with descriptive prompt to an autonomous assistant that will then go and execute the assignment based on the information provided.",
        parameters: {
          type: "object",
          properties: {
            instructions: {
              type: "array",
              description:
                "The information that will enable an assistant go an execute a provided task.",
              items: {
                type: "object",
                properties: {
                  prompt: {
                    type: "string",
                  },
                  agent_id: {
                    type: "array",
                    description: "The list agent_id who will work",
                    enum: [...assistants.map((a) => a.id), "<none>"],
                  },
                },
              },
            },
          },
          required: ["instructions"],
        },
      },
    },
  ];
}

/**
 * Take thread messages and convert them into the traditional role, content format that are used to pre-populate a thread with
 * messages.
 */
export async function messageHistoryForThread(
  client: SwarmManager["client"],
  logger: SwarmManager["log"],
  threadId: string,
): Promise<MessageHistory[]> {
  return await new Promise(async (resolve, _) => {
    try {
      let _messages: MessageHistory[] = [];
      let nextPage: null | string = null;
      let hasMorePages = true;

      while (hasMorePages) {
        const response: OpenAI.Beta.Threads.ThreadMessagesPage =
          await client.beta.threads.messages.list(threadId, {
            limit: 100,
            ...(nextPage ? { after: nextPage } : {}),
          });
        for (const msg of response.data) {
          _messages.push({
            role: "user", // Assistants only support user role right now.
            content: (msg.content as any).find(
              (i: { type: string }) => i.type === "text",
            )?.text?.value,
          });
        }

        hasMorePages = response.hasNextPage();
        nextPage = response.data.slice(-1)?.[0]?.id ?? null;
      }
      resolve(_messages.flat());
    } catch (e: any) {
      logger(e.message);
      resolve([]);
    }
  });
}

/**
 * Get all assistants attached to an account. Handles pagination and all.
 */
export async function _allAssistants(
  client: SwarmManager["assistants"],
  logger: SwarmManager["log"],
): Promise<Assistant[]> {
  return await new Promise(async (resolve, _) => {
    try {
      let _assistants = [];
      let nextPage: null | string = null;
      let hasMorePages = true;

      while (hasMorePages) {
        const response: AssistantListResponse = await client.list({
          limit: 100,
          ...(nextPage ? { after: nextPage } : {}),
        });

        _assistants.push(response.data);
        hasMorePages = response.hasNextPage();
        nextPage = response.data.slice(-1)?.[0]?.id ?? null;
      }
      resolve(_assistants.flat());
    } catch (e: any) {
      logger(e.message);
      resolve([]);
    }
  });
}

/**
 * Gets a list of assistants with concurrency. Useful for concurrent assistant fan-out when that is enabled.
 */
export async function _getAssistants(
  client: SwarmManager["assistants"],
  logger: SwarmManager["log"],
  assistantIds: string[] = [],
): Promise<Assistant[]> {
  // If the <any> client is passed in at all in to the array we short-circuit to all
  // assistants
  if (assistantIds.includes("<any>"))
    return await _allAssistants(client, logger);

  const assistantPromises = [];
  for (const assistantId of assistantIds) {
    assistantPromises.push(
      new Promise(async (resolve) => {
        try {
          await client
            .retrieve(assistantId)
            .then((assistant) => resolve(assistant))
            .catch((e: any) => {
              logger(e.message);
              resolve(null);
            });
        } catch (e: any) {
          logger(e.message);
          resolve(null);
        }
      }),
    );
  }

  const assistants = (await Promise.all(assistantPromises)).filter(
    (assistant) => assistant !== null,
  );
  return assistants as Assistant[];
}

/**
 * Poll a run on a thread until it has reached a settled state or until we time it out.
 * Settled states are all states that are not queued or in_progress.
 */
export async function pollRun(
  client: SwarmManager["client"],
  logGroup: SwarmManager["logGroup"],
  logger: SwarmManager["log"],
  runItem: OpenAI.Beta.Threads.Run,
): Promise<OpenAI.Beta.Threads.Run> {
  if (!["queued", "in_progress"].includes(runItem.status)) return runItem;

  logGroup(`Polling status of ${runItem.id}...`);
  let count = 1;
  let polling = true;
  const pollInterval = 5000;
  while (polling) {
    if (count > 5) {
      logGroup(null, true);
      return runItem;
    }

    const run = await client.beta.threads.runs.retrieve(
      runItem.thread_id,
      runItem.id,
    );
    logger({ status: run.status });

    if (!["queued", "in_progress"].includes(run.status)) {
      logGroup(null, true);
      return run;
    }

    count++;
    await new Promise((r) => setTimeout(r, pollInterval * count));
  }

  logGroup(null, true);
  return runItem;
}

/**
 * Get the first assistant text message from a thread that was sent.
 * You should only run this once you know the thread is in a settled state.
 * Why is it in ascending order and get the first assistant message?
 *
 * -> Sometimes on worse models (3.5t) the assistant will respond to itself for no reason and chat with itself until it tires out
 * when this happens the first response is 100% perfect, but the next one will be as if the thread failed to delegate.
 *
 */
export async function runMessage(
  client: SwarmManager["client"],
  logger: SwarmManager["log"],
  runItem: OpenAI.Beta.Threads.Run,
): Promise<string> {
  try {
    const lastMessageText = client.beta.threads.messages
      .list(runItem.thread_id, { limit: 10, order: "asc" })
      .then(({ data }) => data.find((msg) => msg.role === "assistant"))
      .then((firstAssistantMsg) => {
        if (!firstAssistantMsg) throw new Error("Assistant never responded.");
        return firstAssistantMsg.content.find(
          (content) => content.type === "text",
        );
      })
      .then((textContent) => {
        return (textContent as OpenAI.Beta.Threads.Messages.MessageContentText)
          ?.text?.value;
      })
      .then((text) => {
        if (!text) throw new Error("No response was created.");
        return text;
      });
    return lastMessageText;
  } catch (e: any) {
    logger(e.message);
    return "Failed to get a written response from the thread.";
  }
}

/**
 * When parallel function calling is done we can have the same results being created
 * for the same tool_call - so here we compress all results related to a single tool_call_id
 */
export function deDupeToolOutputs(
  toolOutputs: RunSubmitToolTempOutput[],
): RunSubmitToolOutputsParams.ToolOutput[] {
  const compressed: RunSubmitToolTempOutput[] = [];
  const uniqueCallIds = new Set();

  for (const output of toolOutputs) {
    if (uniqueCallIds.has(output.tool_call_id)) {
      const existing = compressed.find((call) => call.tool_call_id) as
        | RunSubmitToolTempOutput
        | undefined;
      if (!existing) continue;

      existing.output = [...existing.output, output.output].flat();
      continue;
    }

    compressed.push(output);
    uniqueCallIds.add(output.tool_call_id);
  }

  return compressed.map((res) => {
    return {
      tool_call_id: res.tool_call_id,
      output: JSON.stringify(res.output),
    };
  });
}
