import { Run } from "openai/resources/beta/threads/runs/runs";
import { DelegatedToolCall, MessageHistory, DelegateRun } from "../utils/types";
import { _allAssistants, _getAssistants, pollRun, runMessage } from "../utils";
import SwarmManager from ".";

export default class SwarmAssistant {
  private super: SwarmManager;
  constructor(parent: SwarmManager) {
    this.super = parent;
  }

  async runDelegatedTask(
    parentRun: Run,
    toolCall: DelegatedToolCall,
    messageHistory: MessageHistory[],
  ): Promise<DelegateRun> {
    const lastMsg = messageHistory?.slice(-1)?.[0]?.content || null;
    const delegationMessage = `You are being assigned a task from the system! Use all available information and your instructions to complete it with 100% satisfaction.
  System: ${toolCall.args.prompt}

  The last user message was the following:
  ${lastMsg}
  `;
    const thread = await this.super.client.beta.threads.create({
      messages: [{ role: "user", content: delegationMessage }],
      metadata: {
        delegatedBy: parentRun.assistant_id,
        viaFunc: toolCall.function,
        toAssistant: toolCall.agentId,
        originatingToolCallId: toolCall.id,
        createdBy: "@mintplex-labs/openai-assistant-swarm",
      },
    });
    if (!thread) throw new Error("Failed to create thread for sub task.");
    if (!this.super.knownAssistantIds?.includes(toolCall.agentId))
      throw new Error(
        `Assistant ${toolCall.agentId} is not a known assistant! Must have been hallucinated.`,
      );
    const assistant = (
      await _getAssistants(this.super.assistants, this.super.log, [
        toolCall.agentId,
      ])
    )?.[0];
    const run = await this.super.client.beta.threads.runs.create(thread.id, {
      assistant_id: assistant.id,
    });
    if (!run)
      throw new Error(
        `Failed to create run for thread of sub task for assistant ${toolCall.agentId}.`,
      );

    this.super.emitEvent("poll_event", {
      data: {
        status: "child_run_created",
        prompt: delegationMessage,
        playground: this.super.playgroundLink(run),
        run,
      },
    });

    // Will get us to either completed, none, or action required. In which case now the user needs to
    // run that action to whatever it is tied to in their codebase.
    this.super.log(
      `Running sub-child task for ${assistant.id} (${assistant.name})`,
    );
    this.super.log({
      childThreadPlaygroundLink: this.super.playgroundLink(run),
    });

    const settledRun = await pollRun(
      this.super.client,
      this.super.logGroup,
      this.super.log,
      run,
    );
    const textResponse =
      settledRun.status === "completed"
        ? await runMessage(this.super.client, this.super.log, settledRun)
        : null;

    this.super.emitEvent("poll_event", {
      data: {
        status: "child_run_concluded",
        playground: this.super.playgroundLink(run),
        textResponse,
        run: settledRun,
      },
    });

    return {
      abortReason: null,
      textResponse:
        settledRun.status === "completed"
          ? await runMessage(this.super.client, this.super.log, settledRun)
          : null,
      parentToolCallId: toolCall.id,
      status: "success",
      run: settledRun,
      playground: this.super.playgroundLink(settledRun),
      assistant,
      parentRun,
      thread,
    };
  }
}
