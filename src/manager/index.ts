import EventEmitter from "events";
import OpenAI from "openai";
import { Assistant } from "openai/resources/beta/assistants/assistants";
import {
  Run,
  RunCreateParams,
  RunSubmitToolOutputsParams,
} from "openai/resources/beta/threads/runs/runs";
import {
  ManagerOptions,
  DelegatedToolCall,
  DelegationResponse,
  DelegateRun,
  EventTypes,
  ParentResponseEvent,
  SubRunResponseEvent,
  PollEvent,
  RunSubmitToolTempOutput,
} from "../utils/types";
import {
  DEFAULT_OPTS,
  _allAssistants,
  _getAssistants,
  deDupeToolOutputs,
  messageHistoryForThread,
  pollRun,
  runMessage,
  toolsFromAssistants,
} from "../utils";
import SwarmAssistant from "./child";
import { compressToolCalls } from "../utils/toolCalls";

export default class SwarmManager {
  public emitter: EventEmitter;
  public client: OpenAI;
  public knownAssistantIds?: string[];
  public assistants: OpenAI["beta"]["assistants"];
  public log: (_: any) => void;
  public logGroup: (_: any, __?: any) => void;

  private ready: boolean;
  private _mgrBotName: string;
  private mgrAssistant?: Assistant;
  private options: ManagerOptions;

  constructor(client: OpenAI, options?: ManagerOptions) {
    this.emitter = new EventEmitter();
    this.ready = false;
    this.mgrAssistant;
    this.knownAssistantIds = [];
    this.client = client;
    this.assistants = client.beta.assistants;
    this.options = options ?? DEFAULT_OPTS;
    this._mgrBotName =
      this.options.managerAssistantOptions?.name ||
      DEFAULT_OPTS.managerAssistantOptions.name;

    this.log = options?.debug
      ? (arg: any) => {
          console.log(`\x1b[44mDBG: Assistant-Swarm\x1b[0m`, arg);
        }
      : (_: any) => null;
    this.logGroup = options?.debug
      ? (title: string | null, end?: boolean) => {
          if (end) {
            console.groupEnd();
            return;
          }
          console.group(title);
        }
      : (_: any, __?: any) => null;
  }

  private isReady(): boolean {
    if (!this.ready)
      throw new Error(`SwarmManager requires .init() to be called before use.`);
    return true;
  }

  private async findOrUpsertManager(): Promise<boolean> {
    const assistants = await _allAssistants(this.assistants, this.log);
    const mgrAssistant = assistants.find((a) => a.name === this._mgrBotName);
    const availableAssistants = assistants.filter(
      (a) => a.name !== this._mgrBotName,
    );
    const newOpts = {
      name:
        this.options.managerAssistantOptions?.name ||
        DEFAULT_OPTS.managerAssistantOptions.name,
      model:
        this.options.managerAssistantOptions?.model ||
        DEFAULT_OPTS.managerAssistantOptions.model,
      instructions:
        this.options.managerAssistantOptions?.instructions ||
        `You are a manager of assistants that all perform various functions. Your job is to select the best or top assistants under your direction to complete a job. If you do not have the assistant or ability to fulfill the required request by the user respond with the agent_id of '<none>'. If you respond with the agent_id of '<none>' tell the user that you are sorry and cannot process their request as the required assistant to do so is not available currently. It is very important that you get this right and always have the end user satisfied with your choice of assistant calls and end result. Each time you delegate you should reword the task to the assistant in terms and actions that is specific to that assistant's details and role. You will NEVER directly respond to the user input and will instead acknowledge their needs and announce that you will relay this request to another assistant if not <none>, who can best handle their needs.`,
      tools: toolsFromAssistants(availableAssistants),
    };

    if (!!mgrAssistant) {
      this.log(
        "Primary Swarm Manager already exists - upserting new options...",
      );
      const updatedMgr = await this.assistants.update(mgrAssistant.id, newOpts);
      this.mgrAssistant = updatedMgr;
      this.knownAssistantIds = availableAssistants.map((a) => a.id);
      return !!mgrAssistant;
    }

    const newAssistant = await this.assistants.create(newOpts);
    this.log("New Primary Swarm Manager was created!");
    this.mgrAssistant = newAssistant;
    this.knownAssistantIds = availableAssistants.map((a) => a.id);
    return !!newAssistant;
  }

  private async delegateTaskToChildren(primaryRun: Run): Promise<{
    concludedPrimaryRun: ParentResponseEvent["data"]["parentRun"];
    subRuns: DelegateRun[];
  }> {
    // If primary run does not require any action at all - return the primary run.
    if (primaryRun.status !== "requires_action") {
      const textResponse = await runMessage(this.client, this.log, primaryRun);

      this.emitEvent("poll_event", {
        data: {
          status: "parent_run_concluded",
          textResponse,
          playground: this.playgroundLink(primaryRun),
          run: primaryRun,
        },
      });
      this.emitEvent("parent_assistant_complete", {
        data: {
          parentRun: {
            ...primaryRun,
            playground: this.playgroundLink(primaryRun),
            textResponse,
          },
        },
      });
      this.emitEvent("child_assistants_complete", { data: { subRuns: [] } });
      this.emitEvent("poll_event", { data: { status: "DONE" } });

      return {
        concludedPrimaryRun: {
          ...primaryRun,
          playground: this.playgroundLink(primaryRun),
          textResponse,
        },
        subRuns: [],
      };
    }

    const toolCalls: DelegatedToolCall[] = compressToolCalls(this, primaryRun);
    const uniqueAgents = new Set();
    const toolOutputs: RunSubmitToolTempOutput[] = [];
    const subRunRequests: (() => Promise<DelegateRun>)[] = [];
    const messageHistory = await messageHistoryForThread(
      this.client,
      this.log,
      primaryRun.thread_id,
    );

    for (const toolCall of toolCalls) {
      if (toolCall.agentId === "<none>") {
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: [
            {
              originatingToolCallId: toolCall.id,
              delegatedTo: "nobody",
              viaFunc: toolCall.function,
            },
          ],
        });
        continue;
      }

      uniqueAgents.add(toolCall.agentId);
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: [
          {
            originatingToolCallId: toolCall.id,
            delegatedTo: toolCall.agentId,
            viaFunc: toolCall.function,
          },
        ],
      });

      subRunRequests.push(() => {
        return new Promise(async (resolve) => {
          try {
            const swarmAssistant = new SwarmAssistant(this);
            await swarmAssistant
              .runDelegatedTask(primaryRun, toolCall, messageHistory)
              .then((runInfo) => {
                resolve(runInfo as DelegateRun);
              })
              .catch((e: any) => {
                this.log(e);
                resolve({
                  status: "failed",
                  parentRun: primaryRun,
                  parentToolCallId: toolCall.id,
                  abortReason: e.message,
                  playground: null,
                  textResponse: null,
                  assistant: null,
                  thread: null,
                  run: null,
                } as DelegateRun);
              });
          } catch (e: any) {
            this.log(e);
            resolve({
              status: "failed",
              parentRun: primaryRun,
              parentToolCallId: toolCall.id,
              abortReason: e.message,
              playground: null,
              textResponse: null,
              assistant: null,
              thread: null,
              run: null,
            } as DelegateRun);
          }
        });
      });
    }

    const subRunsPromise: any = (): Promise<DelegateRun[]> => {
      return new Promise(async (resolve) => {
        this.log(
          `Fanning out ${subRunRequests.length} tool executions for ${uniqueAgents.size} agents across swarm.`,
        );

        await Promise.all(subRunRequests.flat().map((fn) => fn())).then(
          (results) => {
            this.emitEvent("child_assistants_complete", {
              data: { subRuns: results },
            });
            resolve(results);
          },
        );
      });
    };

    const concludedPrimaryRunPromise: any = () => {
      return new Promise(async (resolve) => {
        const _runClosedRun =
          await this.client.beta.threads.runs.submitToolOutputs(
            primaryRun.thread_id,
            primaryRun.id,
            {
              tool_outputs: deDupeToolOutputs(toolOutputs),
            },
          );
        const concludedPrimaryRun = await pollRun(
          this.client,
          this.logGroup,
          this.log,
          _runClosedRun,
        );
        const textResponse = await runMessage(
          this.client,
          this.log,
          concludedPrimaryRun,
        );

        this.emitEvent("poll_event", {
          data: {
            status: "parent_assistant_complete",
            playground: this.playgroundLink(concludedPrimaryRun),
            textResponse,
            run: concludedPrimaryRun,
          },
        });
        this.emitEvent("parent_assistant_complete", {
          data: {
            parentRun: {
              ...concludedPrimaryRun,
              playground: this.playgroundLink(concludedPrimaryRun),
              textResponse,
            },
          },
        });

        resolve({
          ...concludedPrimaryRun,
          playground: this.playgroundLink(concludedPrimaryRun),
          textResponse,
        });
      });
    };

    const [concludedPrimaryRun, subRuns] = await Promise.all([
      concludedPrimaryRunPromise(),
      subRunsPromise(),
    ]);
    this.log("Swarm Complete.");
    return { concludedPrimaryRun, subRuns };
  }

  /**
   * Initializes your account with the primary assistant to execute and delegate to existing assistants
   */
  async init() {
    this.log("Initialization of Swarm Manager is running.");
    const _ready = await this.findOrUpsertManager();
    this.ready = _ready;
  }

  /**
   * Returns a list of all assistants connected to this OpenAI apiKey.
   */
  async allAssistants(): Promise<Assistant[]> {
    this.isReady();
    return (await _allAssistants(this.assistants, this.log)).filter(
      (a) => a.id !== this.mgrAssistant?.id,
    );
  }

  /**
   * Returns multiple assistants at once from multiple ids.
   */
  async getAssistants(assistantIds: string[] = []): Promise<Assistant[]> {
    this.isReady();
    return (
      await _getAssistants(this.assistants, this.log, assistantIds)
    ).filter((a) => a.id !== this.mgrAssistant?.id);
  }

  /**
   * Cleanup and remove primary swarm assistant manager from your account.
   * Only removes the one created with this script using the params defined during creation of class.
   */
  async cleanup() {
    this.isReady();
    if (!this.mgrAssistant) return;
    await this.assistants.del(this.mgrAssistant.id);
    this.log(
      `Primary swarm assistant manager was deleted from OpenAI account.`,
    );
    return;
  }

  /**
   * Emit informative event from the swarm process running.
   */
  emitEvent(
    event: EventTypes,
    args: ParentResponseEvent | SubRunResponseEvent | PollEvent,
  ) {
    this.emitter.emit(event, args);
  }

  /**
   * Generate the Playground link for an assistant and thread for visualization in the browser.
   */
  playgroundLink(run?: Run | null): string | null {
    if (!run) return null;
    return `https://platform.openai.com/playground?assistant=${run.assistant_id}&mode=assistant&thread=${run.thread_id}`;
  }

  /**
   * Given a single prompt we will create a thread and then find the best option
   * for assistant execution to complete or fulfill the task.
   */
  async delegateWithPrompt(
    prompt: string,
    assistantIds: string[] = ["<any>"],
    runOpts?: RunCreateParams,
  ): Promise<DelegationResponse> {
    this.isReady();
    const thread = await this.client.beta.threads.create({
      messages: [{ role: "user", content: prompt }],
      metadata: {
        createdBy: "@mintplex-labs/openai-assistant-swarm",
      },
    });
    if (!thread) throw new Error("Failed to create thread.");

    const mgrAssistant = this.mgrAssistant as Assistant;
    const assistants = await this.getAssistants(assistantIds);

    // If the user defined a sub-set of assistants we want to reduce scope of known assistants
    // so we don't execute tasks outside of the subset.
    this.knownAssistantIds = assistants.map((a) => a.id);

    const run = await this.client.beta.threads.runs.create(thread.id, {
      assistant_id: mgrAssistant.id,
      tools: toolsFromAssistants(assistants),
      instructions: `${
        mgrAssistant.instructions
      } Your available assistants and their descriptions are presented between <assistant></assistant> tags with their id and descriptions. Only select assistants that are explicitly listed here.
${assistants.map((assistant: Assistant) => {
  return `<assistant>
<agent_id>${assistant.id}</agent_id>
<name>${assistant.name}</name>
<description>${assistant.description ?? assistant.instructions}</description>
</assistant>`;
})},`,
      ...(!!runOpts ? { ...runOpts } : {}),
    });

    this.log(`Run created: ${run.id}`);
    this.log({ parentThreadPlaygroundLink: this.playgroundLink(run) });
    this.emitEvent("poll_event", {
      data: {
        status: "parent_run_created",
        prompt,
        playground: this.playgroundLink(run),
        run,
      },
    });

    const settledManagerRun = await pollRun(
      this.client,
      this.logGroup,
      this.log,
      run,
    );

    return await this.delegateTaskToChildren(settledManagerRun);
  }
}
