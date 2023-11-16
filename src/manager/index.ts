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
  DelegationArguments,
  DelegatedToolCall,
  DelegationResponse,
  MessageHistory,
  DelegateRun,
  EventTypes,
  ParentResponseEvent,
  SubRunResponseEvent,
} from "../utils/types";
import {
  DEFAULT_OPTS,
  _allAssistants,
  _getAssistants,
  messageHistoryForThread,
  pollRun,
  runMessage,
  toolsFromAssistants,
} from "../utils";

export default class SwarmManager {
  public emitter: EventEmitter;
  private ready: boolean;
  private _mgrBotName: string;
  private mgrAssistant?: Assistant;
  private client: OpenAI;
  private assistants: OpenAI["beta"]["assistants"];
  private options: ManagerOptions;
  private knownAssistantIds?: string[];
  private log: (_: any) => void;
  private logGroup: (_: any, __?: any) => void;

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

  private emitEvent(
    event: EventTypes,
    args: ParentResponseEvent | SubRunResponseEvent,
  ) {
    this.emitter.emit(event, args);
  }

  private playgroundLink(run?: Run | null): string | null {
    if (!run) return null;
    return `https://platform.openai.com/playground?assistant=${run.assistant_id}&mode=assistant&thread=${run.thread_id}`;
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

  private async runSubDelegation(
    parentRun: Run,
    toolCall: DelegatedToolCall,
    messageHistory: MessageHistory[],
  ): Promise<DelegateRun> {
    const thread = await this.client.beta.threads.create({
      messages: [
        ...messageHistory,
        { role: "user", content: toolCall.args.prompt },
      ],
      metadata: {
        delegatedBy: parentRun.assistant_id,
        viaFunc: toolCall.function,
        toAssistant: toolCall.agentId,
        originatingToolCallId: toolCall.id,
        createdBy: "@mintplex-labs/openai-assistant-swarm",
      },
    });
    if (!thread) throw new Error("Failed to create thread for sub task.");
    if (!this.knownAssistantIds?.includes(toolCall.agentId))
      throw new Error(
        `Assistant ${toolCall.agentId} is not a known assistant! Must have been hallucinated.`,
      );
    const assistant = (
      await _getAssistants(this.assistants, this.log, [toolCall.agentId])
    )?.[0];
    const run = await this.client.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
    });
    if (!run)
      throw new Error(
        `Failed to create run for thread of sub task for assistant ${toolCall.agentId}.`,
      );

    // Will get us to either completed, none, or action required. In which case now the user needs to
    // run that action to whatever it is tied to in their codebase.
    this.log(`Running sub-child task for ${assistant.id} (${assistant.name})`);
    this.log({ childThreadPlaygroundLink: this.playgroundLink(run) });
    const settledRun = await pollRun(this.client, this.logGroup, this.log, run);

    return {
      abortReason: null,
      textResponse:
        settledRun.status === "completed"
          ? await runMessage(this.client, this.log, settledRun)
          : null,
      parentToolCallId: toolCall.id,
      status: "success",
      run: settledRun,
      playground: this.playgroundLink(settledRun),
      assistant,
      parentRun,
      thread,
    };
  }

  private async delegateTask(primaryRun: Run): Promise<{
    concludedPrimaryRun: ParentResponseEvent["parentRun"];
    subRuns: DelegateRun[];
  }> {
    // If primary run does not require any action at all - return the primary run.
    if (primaryRun.status !== "requires_action") {
      const textResponse = await runMessage(this.client, this.log, primaryRun);

      this.emitEvent("parent_assistant_complete", {
        parentRun: {
          ...primaryRun,
          playground: this.playgroundLink(primaryRun),
          textResponse,
        },
      });
      this.emitEvent("child_assistants_complete", { subRuns: [] });

      return {
        concludedPrimaryRun: {
          ...primaryRun,
          playground: this.playgroundLink(primaryRun),
          textResponse,
        },
        subRuns: [],
      };
    }

    const toolCalls: DelegatedToolCall[] =
      primaryRun.required_action?.submit_tool_outputs?.tool_calls
        ?.filter((call) => {
          let args: undefined | DelegationArguments;
          try {
            args = JSON.parse(call.function.arguments);
          } catch {}

          return call.function.name === "delegate" && !!args?.agent_id;
        })
        ?.map((call) => {
          const args = JSON.parse(call.function.arguments);
          return {
            id: call.id,
            function: call.function.name,
            agentId: args.agent_id,
            args,
          };
        }) || [];

    const uniqueAgents = new Set();
    const toolOutputs: RunSubmitToolOutputsParams.ToolOutput[] = [];
    const subRunRequests: Promise<DelegateRun>[] = [];
    const messageHistory = await messageHistoryForThread(
      this.client,
      this.log,
      primaryRun.thread_id,
    );
    for (const toolCall of toolCalls) {
      if (toolCall.agentId === "<none>") {
        toolOutputs.push({
          tool_call_id: toolCall.id,
          output: JSON.stringify({
            originatingToolCallId: toolCall.id,
            delegatedTo: "nobody",
            viaFunc: toolCall.function,
          }),
        });
        continue;
      }

      uniqueAgents.add(toolCall.agentId);
      toolOutputs.push({
        tool_call_id: toolCall.id,
        output: JSON.stringify({
          originatingToolCallId: toolCall.id,
          delegatedTo: toolCall.agentId,
          viaFunc: toolCall.function,
        }),
      });

      subRunRequests.push(
        new Promise(async (resolve) => {
          try {
            await this.runSubDelegation(primaryRun, toolCall, messageHistory)
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
        }),
      );
    }

    const subRunsPromise: any = () => {
      return new Promise(async (resolve) => {
        // Fan out the child processes and wait for them to return some type of response.
        this.log(
          `Fanning out ${subRunRequests.length} tool executions for ${uniqueAgents.size} agents across swarm.`,
        );
        await Promise.all(subRunRequests.flat()).then((results) => {
          this.emitEvent("child_assistants_complete", { subRuns: results });
          resolve(results);
        });
      });
    };

    const concludedPrimaryRunPromise: any = () => {
      return new Promise(async (resolve) => {
        const _runClosedRun =
          await this.client.beta.threads.runs.submitToolOutputs(
            primaryRun.thread_id,
            primaryRun.id,
            {
              tool_outputs: toolOutputs,
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

        this.emitEvent("parent_assistant_complete", {
          parentRun: {
            ...concludedPrimaryRun,
            playground: this.playgroundLink(concludedPrimaryRun),
            textResponse,
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
    const run = await this.client.beta.threads.runs.create(thread.id, {
      assistant_id: mgrAssistant.id,
      tools: toolsFromAssistants(assistants),
      instructions: `${
        mgrAssistant.instructions
      } Your available assistants and their descriptions are presented between <assistant></assistant> tags with their id and descriptions. Only select assistants are explicitly listed here.
${assistants.map((assistant: Assistant) => {
  return `<assistant>
<id>${assistant.id}</id>
<name>${assistant.name}</name>
<description>${assistant.description ?? assistant.instructions}</description>
</assistant>`;
})},`,
      ...(!!runOpts ? { ...runOpts } : {}),
    });

    this.log(`Run created: ${run.id}`);
    this.log({ parentThreadPlaygroundLink: this.playgroundLink(run) });
    const settledManagerRun = await pollRun(
      this.client,
      this.logGroup,
      this.log,
      run,
    );

    return await this.delegateTask(settledManagerRun);
  }

  /**
   * Given a message history we will create a thread and then find the best option
   * for assistant execution to complete or fulfill the task.
   */
  // async delegateWithMessages(
  //   messages: MessageHistory[],
  //   assistantIds: string[] | '<any>' = '<any>',
  //   runOpts?: RunCreateParams
  // ) {
  //   throw new Error('Not implemented.');
  //   return;
  // }
}
