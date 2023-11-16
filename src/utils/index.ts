import { Assistant } from "openai/resources/beta/assistants/assistants";
import { AssistantListResponse, MessageHistory } from "./types";
import SwarmManager from "../manager";
import OpenAI from "openai";

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
          "Assigns a given descriptive prompt to an autonomous assistant that will then go and execute the job and return a response based on the task given.",
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description:
                "Descriptive definition of task that the assistant should use to help complete the main task. This prompt is tailored to the description and role of the assistant",
            },
            agent_id: {
              type: "string",
              enum: [...assistants.map((a) => a.id), "<none>"],
            },
          },
          required: ["prompt", "agent_id"],
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
 * Get the last text message from a thread that was sent by either the user or the assistant.
 * You should only run this once you know the thread is in a settled state.
 */
export async function runMessage(
  client: SwarmManager["client"],
  logger: SwarmManager["log"],
  runItem: OpenAI.Beta.Threads.Run,
): Promise<string> {
  try {
    const lastMessageText = client.beta.threads.messages
      .list(runItem.thread_id, { limit: 1, order: "desc" })
      .then(({ data }) => data[0])
      .then((msg) => msg.content.find((content) => content.type === "text"))
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
